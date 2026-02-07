import numpy as np
import onnx
import torch
from lightgbm import LGBMClassifier
from onnx import TensorProto, helper, numpy_helper
from torch import nn

from dataset import CHANNELS, LABELS, WINDOW, rolling


class Graph:
    def __init__(self):
        self.nodes, self.constants = [], []

    def const(self, name, array):
        self.constants.append(numpy_helper.from_array(np.asarray(array), name))
        return name

    def op(self, kind, inputs, name, **attrs):
        self.nodes.append(helper.make_node(kind, inputs, [name], **attrs))
        return name

    def finish(self, shape):
        info = helper.make_tensor_value_info
        graph = helper.make_graph(self.nodes, "deskframe", [info("input", TensorProto.FLOAT, shape)],
                                  [info("scores", TensorProto.FLOAT, [1, len(LABELS)])], self.constants)
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], ir_version=10,
                                  producer_name="deskframe")
        onnx.checker.check_model(model)
        return model.SerializeToString()



def rules_graph():
    g = Graph()
    row = g.op("Gather", ["input",g.const("end",np.int64(WINDOW-1))], "last", axis=1)
    flags = []
    for i, cutoff in enumerate([7, .1]):
        val = g.op("Gather",[row,g.const(f"id{i}",np.int64(i))],f"val{i}",axis=1)
        flags.append(g.op("GreaterOrEqual",[val,g.const(f"cut{i}",np.float32(cutoff))],f"flag{i}"))
    flag = g.op("Or",flags,"changed")
    g.op("Where",[flag,g.const("slouch",np.asarray([[0,1,0,0,0]],np.float32)),
                  g.const("neutral",np.asarray([[1,0,0,0,0]],np.float32))],"scores")
    return g.finish([1,WINDOW,len(CHANNELS)])


def tree_graph(model):
    trees = model.booster_.dump_model()["tree_info"]
    depth = 3
    size = 2 ** (depth+1)-1
    n = len(trees)
    feature = np.zeros(n*size, np.int64)
    threshold = np.zeros(n*size, np.float32)
    left = np.zeros(n*size, np.int64)
    leaves = np.zeros((n,size), np.float32)

    def visit(tree, tree_id, index, level):
        pos = tree_id*size + index
        if level == depth:
            leaves[tree_id,index] = tree["leaf_value"]
            return
        left[pos] = tree_id*size + 2*index + 1
        if "leaf_value" in tree:
            a = b = tree
        else:
            if tree["decision_type"] != "<=":
                raise ValueError("Unsupported LightGBM split.")
            feature[pos], threshold[pos] = tree["split_feature"], tree["threshold"]
            a, b = tree["left_child"], tree["right_child"]
        visit(a, tree_id, 2*index+1, level+1)
        visit(b, tree_id, 2*index+2, level+1)

    for i, tree in enumerate(trees):
        visit(tree["tree_structure"], i, 0, 0)
    g = Graph()
    root = g.const("roots", np.arange(n,dtype=np.int64)*size)
    fields, cuts, child = g.const("fields",feature), g.const("cuts",threshold), g.const("left",left)
    flat = g.op("Flatten",["input"],"flat",axis=0)
    flat = g.op("Reshape",[flat,g.const("one_dim",np.asarray([-1],np.int64))],"features")
    for d in range(depth):
        ids = g.op("Gather",[fields,root],f"ids{d}")
        values = g.op("Gather",[flat,ids],f"values{d}")
        lim = g.op("Gather",[cuts,root],f"lim{d}")
        bit = g.op("Greater",[values,lim],f"right{d}")
        offset = g.op("Cast",[bit],f"offset{d}",to=TensorProto.INT64)
        base = g.op("Gather",[child,root],f"base{d}")
        root = g.op("Add",[base,offset],f"nodes{d}")
    scale = np.maximum(np.abs(leaves).max(axis=1)/127,1e-9).astype(np.float32)
    q = np.rint(leaves/scale[:,None]).clip(-127,127).astype(np.int8)
    selected = g.op("Gather",[g.const("leaf_q",q.flatten()),root],"selected")
    values = g.op("Cast",[selected],"leaf_float",to=TensorProto.FLOAT)
    logits = g.op("Mul",[values,g.const("tree_scales",scale)],"logits")
    scores = g.op("Reshape",[logits,g.const("shape",np.asarray([-1,len(LABELS)],np.int64))],"rounds")
    g.op("ReduceSum",[scores,g.const("axis",np.asarray([0],np.int64))],"scores",keepdims=1)
    return g.finish([1,4*len(CHANNELS)+2])


class TemporalCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(nn.Conv1d(6,12,3,padding=1), nn.ReLU(),
                                 nn.Conv1d(12,12,3,padding=1), nn.ReLU(),
                                 nn.AdaptiveAvgPool1d(1), nn.Flatten(), nn.Linear(12,len(LABELS)))

    def forward(self,x):
        return self.net(x)




def fit(kind, x, y, epochs):
    if kind == "rules":
        return lambda rows: ((rows[:,-1,0] >= 7) | (rows[:,-1,1] >= np.float32(.1))).astype(int)
    if kind.startswith("tree"):
        model = LGBMClassifier(n_estimators=24, max_depth=3, num_leaves=8, min_child_samples=4,
                               random_state=17, verbosity=-1, n_jobs=1, deterministic=True, force_col_wise=True)
        features = rolling(x)
        if kind == "tree_levels_only":
            features[:,10:30] = 0
            features[:,-2:] = 0
        model.fit(features,y)
        return model
    torch.manual_seed(17)
    torch.set_num_threads(1)
    base = x[:,:,4:]
    mean = base.mean(axis=(0,1))
    scale = base.std(axis=(0,1)).clip(.001)
    data = torch.from_numpy(((base-mean)/scale).transpose(0,2,1).copy())
    target = torch.tensor(y,dtype=torch.long)
    model = TemporalCNN()
    optim = torch.optim.Adam(model.parameters(),lr=.005)
    for _ in range(epochs):
        for batch in torch.randperm(len(data)).split(48):
            optim.zero_grad()
            nn.functional.cross_entropy(model(data[batch]),target[batch]).backward()
            optim.step()
    return model.eval(), mean, scale

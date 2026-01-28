import numpy as np
import torch
from dataset import rolling
from models import fit

def inference(model, kind, x):
    if kind == 'rules':
        return model(x), []
    if kind.startswith('tree'):
        return model.predict(rolling(x)), []
    net, mean, scale = model
    seq = torch.from_numpy(((x[:,:,4:]-mean)/scale).transpose(0,2,1).copy())
    with torch.no_grad():
        return net(seq).argmax(dim=1).numpy(), []

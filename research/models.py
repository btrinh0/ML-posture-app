import numpy as np

from dataset import CHANNELS, LABELS, WINDOW, rolling










def fit(kind, x, y, epochs):
    if kind == "rules":
        return lambda rows: ((rows[:,-1,0] >= 7) | (rows[:,-1,1] >= np.float32(.1))).astype(int)

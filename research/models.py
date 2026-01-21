import numpy as np
from lightgbm import LGBMClassifier

from dataset import CHANNELS, LABELS, WINDOW, rolling










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

def grouped_folds(data):
    for scheme, groups in [('leave_one_session_out', data.session)]:
        if len(set(groups)) < 2:
            raise ValueError(f'{scheme} requires two independent groups')
        for group in sorted(set(groups)):
            test = groups == group
            yield scheme, group, ~test & data.trainable, test

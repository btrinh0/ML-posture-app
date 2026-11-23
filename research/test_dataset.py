import unittest
import numpy as np

from dataset import windows
from benchmark import metrics


def record(sec, label="neutral", segment=1):
    return dict(participant="p", session="v", version=1, second=sec, label=label, segment=segment, vector=[0]*10)


class StudyWindowsTest(unittest.TestCase):
    def test_gaps_cannot_be_bridged_and_repeat_exports_are_deduplicated(self):
        rows = [record(i) for i in list(range(12)) + list(range(15,40))]
        w = windows(rows+rows)
        np.testing.assert_array_equal(w.second,np.arange(34,40))
        with self.assertRaisesRegex(ValueError,"Conflicting"):
            windows(rows + [record(39,"slouch")])

    def test_transition_windows_are_scored_and_excluded_from_fitting(self):
        w = windows([record(i) if i<21 else record(i,"writing",2) for i in range(42)])
        self.assertIn(25,w.second)
        self.assertNotIn(25,w.second[w.trainable])
        np.testing.assert_array_equal(w.second[w.trainable],[20,40])

    def test_false_alert_rate_counts_events_and_observed_seconds(self):
        rows = [("a",i,2,1) for i in range(60)] + [("b",i,1,1) for i in range(60)]
        result = metrics(rows)
        self.assertEqual(result["alerts"],2)
        self.assertEqual(result["false_alerts"],1)
        self.assertEqual(result["false_alerts_per_hour"],30)


if __name__ == "__main__":
    unittest.main()

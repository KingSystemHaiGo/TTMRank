import unittest
from ttmrank.history_client import HistoryClient

class HistoryClientTests(unittest.TestCase):
    def test_missing_configuration_degrades_without_error(self):
        client=HistoryClient('')
        self.assertFalse(client.ingest([{'id':1,'heat':2}],1000))
        self.assertEqual(client.baselines([1],1000),{})

if __name__=='__main__': unittest.main()

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import mt5_connector as connector


class ConnectorSafetyTests(unittest.TestCase):
    def test_volume_is_floored_to_broker_step(self):
        info = SimpleNamespace(volume_min=0.01, volume_max=100.0, volume_step=0.01)
        self.assertEqual(connector.floor_volume(1.239, info), 1.23)

    def test_volume_below_minimum_is_rejected(self):
        info = SimpleNamespace(volume_min=0.1, volume_max=100.0, volume_step=0.1)
        self.assertEqual(connector.floor_volume(0.09, info), 0.0)

    def test_failed_account_switch_cannot_shutdown_healthy_session(self):
        existing = {"login": 100, "server": "Broker-Demo", "is_demo": True}
        with patch.object(connector, "account_data", return_value=existing), \
             patch.object(connector.mt5, "initialize") as initialize, \
             patch.object(connector.mt5, "shutdown") as shutdown:
            result, status = connector.connect_account({"login": 200, "server": "Other-Demo", "password": "secret"})
        self.assertEqual(status, 409)
        self.assertFalse(result["ok"])
        initialize.assert_not_called()
        shutdown.assert_not_called()

    def test_real_account_is_never_accepted(self):
        existing = {"login": 100, "server": "Broker-Live", "is_demo": False}
        with patch.object(connector, "account_data", return_value=existing), \
             patch.object(connector.mt5, "initialize") as initialize, \
             patch.object(connector.mt5, "shutdown") as shutdown:
            result, status = connector.connect_account({"login": 100, "server": "Broker-Live", "password": "secret"})
        self.assertEqual(status, 403)
        self.assertFalse(result["ok"])
        initialize.assert_not_called()
        shutdown.assert_not_called()

    def test_invalid_side_is_not_silently_treated_as_sell(self):
        result, status = connector.risk_lot({"symbol": "XAUUSD", "side": "hold", "risk_money": 10, "entry": 2000, "stop": 1990})
        self.assertEqual(status, 400)
        self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()

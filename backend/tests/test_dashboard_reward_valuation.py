import unittest
from decimal import Decimal

from app.api.dashboard import reward_program_valuation
from app.models.reward_program import RewardProgram


def make_program(
    value: str | None,
    value_unit: str | None = "cents_per_point",
) -> RewardProgram:
    return RewardProgram(
        name="Test Program",
        short_code="TEST",
        category="Other",
        estimated_value_cents_per_point=(
            Decimal(value) if value is not None else None
        ),
        value_unit=value_unit,
    )


class DashboardRewardValuationTest(unittest.TestCase):
    def test_variable_program_is_excluded_and_marked_variable(self) -> None:
        valuation = reward_program_valuation(
            make_program("1.0000", "variable"),
            Decimal("95401"),
        )

        self.assertEqual(valuation["estimated_value"], Decimal("0"))
        self.assertEqual(valuation["valuation_status"], "variable")
        self.assertEqual(valuation["value_unit"], "variable")

    def test_missing_value_is_excluded_and_marked_not_configured(self) -> None:
        valuation = reward_program_valuation(
            make_program(None, "cents_per_point"),
            Decimal("3009.52"),
        )

        self.assertEqual(valuation["estimated_value"], Decimal("0"))
        self.assertEqual(valuation["valuation_status"], "not_configured")
        self.assertEqual(valuation["value_unit"], "cents_per_point")

    def test_cents_per_point_program_calculates_dollar_value(self) -> None:
        valuation = reward_program_valuation(
            make_program("1.5000", "cents_per_point"),
            Decimal("10000"),
        )

        self.assertEqual(valuation["estimated_value"], Decimal("150.0000"))
        self.assertEqual(valuation["valuation_status"], "fixed")
        self.assertEqual(valuation["value_unit"], "cents_per_point")

    def test_usd_per_token_program_does_not_divide_by_100(self) -> None:
        valuation = reward_program_valuation(
            make_program("0.6200", "usd_per_token"),
            Decimal("10"),
        )

        self.assertEqual(valuation["estimated_value"], Decimal("6.2000"))
        self.assertEqual(valuation["valuation_status"], "fixed")
        self.assertEqual(valuation["value_unit"], "usd_per_token")


if __name__ == "__main__":
    unittest.main()

import unittest
from decimal import Decimal

from app.api.dashboard import (
    add_instant_discount_metric,
    instant_discount_saved_amount,
    is_instant_discount_transaction,
    reward_program_valuation,
)
from app.models.credit_card import CreditCard
from app.models.credit_card_reward_transaction import CreditCardRewardTransaction
from app.models.player import Player
from app.models.purchase_batch import PurchaseBatch
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

    def test_instant_discount_transaction_is_identified_for_separate_display(self) -> None:
        transaction = CreditCardRewardTransaction(
            reward_type="instant_discount_percent",
            rewards_earned=Decimal("0"),
            points_earned=Decimal("0"),
            cashback_amount=Decimal("0"),
            statement_credit_amount=Decimal("0"),
            purchase_discount_amount=Decimal("25.00"),
            effective_savings_amount=Decimal("25.00"),
        )

        self.assertTrue(is_instant_discount_transaction(transaction))
        self.assertEqual(instant_discount_saved_amount(transaction), Decimal("25.00"))

    def test_purchase_discount_amount_identifies_instant_discount_even_if_type_is_legacy(self) -> None:
        transaction = CreditCardRewardTransaction(
            reward_type="points",
            rewards_earned=Decimal("0"),
            points_earned=Decimal("0"),
            cashback_amount=Decimal("0"),
            statement_credit_amount=Decimal("0"),
            purchase_discount_amount=Decimal("10.00"),
            effective_savings_amount=Decimal("10.00"),
        )

        self.assertTrue(is_instant_discount_transaction(transaction))
        self.assertEqual(instant_discount_saved_amount(transaction), Decimal("10.00"))

    def test_cashback_savings_are_not_classified_as_instant_discounts(self) -> None:
        transaction = CreditCardRewardTransaction(
            reward_type="cashback_percent",
            rewards_earned=Decimal("0"),
            points_earned=Decimal("0"),
            cashback_amount=Decimal("5.00"),
            statement_credit_amount=Decimal("0"),
            purchase_discount_amount=Decimal("0"),
            effective_savings_amount=Decimal("5.00"),
        )

        self.assertFalse(is_instant_discount_transaction(transaction))

    def test_instant_discount_summary_groups_actual_saved_value(self) -> None:
        groups = {}
        details = []
        purchase = PurchaseBatch(id=51, store_name="Target")
        card = CreditCard(id=6, nickname="Target Circle", issuer="Target")
        player = Player(id=4, label="P1", name="Steve")
        transaction = CreditCardRewardTransaction(
            id=21,
            purchase_id=51,
            credit_card_id=6,
            player_id=4,
            reward_type="instant_discount_percent",
            qualifying_spend=Decimal("475.00"),
            rewards_earned=Decimal("0"),
            points_earned=Decimal("0"),
            cashback_amount=Decimal("0"),
            statement_credit_amount=Decimal("0"),
            purchase_discount_amount=Decimal("25.00"),
            effective_savings_amount=Decimal("25.00"),
            calculation_source="merchant_reward_rule",
        )

        add_instant_discount_metric(
            groups=groups,
            details=details,
            transaction=transaction,
            purchase=purchase,
            card=card,
            player=player,
        )

        self.assertEqual(list(groups), ["Target:6"])
        self.assertEqual(groups["Target:6"]["label"], "Target Circle Discount")
        self.assertEqual(groups["Target:6"]["total_saved"], Decimal("25.00"))
        self.assertEqual(groups["Target:6"]["eligible_spend"], Decimal("475.00"))
        self.assertEqual(groups["Target:6"]["count"], 1)
        self.assertEqual(details[0]["saved_amount"], Decimal("25.00"))
        self.assertEqual(details[0]["credit_card_nickname"], "Target Circle")


if __name__ == "__main__":
    unittest.main()

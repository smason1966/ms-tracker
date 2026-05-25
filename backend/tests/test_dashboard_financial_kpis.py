import unittest
from datetime import date, datetime
from decimal import Decimal

from app.api.dashboard import sale_financial_kpis
from app.models.sale import Sale


def make_sale(
    sale_id: int,
    expected_payout: str,
    status: str,
    received: str | None = None,
) -> Sale:
    sale = Sale(
        buyer_id=1,
        sold_at=datetime(date.today().year, 5, 15),
        expected_payout=Decimal(expected_payout),
        status=status,
        payout_received=Decimal(received) if received is not None else None,
    )
    sale.id = sale_id
    return sale


class DashboardFinancialKpiTest(unittest.TestCase):
    def test_ytd_gross_sales_excludes_voided_and_uses_expected_payout(self) -> None:
        sales = [
            make_sale(11, "4500", "ACTIVE"),
            make_sale(9, "999", "SOLD_PENDING_PAYMENT"),
            make_sale(8, "999", "SOLD_PENDING_PAYMENT"),
            make_sale(13, "200", "COMPLETED", "200"),
            make_sale(14, "4500", "VOIDED"),
            make_sale(15, "300", "VOIDED"),
        ]

        kpis = sale_financial_kpis(
            sales,
            date(date.today().year, 1, 1),
            None,
        )

        self.assertEqual(kpis["gross_sales"], Decimal("6698"))
        included_ids = {
            row["sale_id"] for row in kpis["rows"] if row["included_in_gross_sales"]
        }
        excluded_ids = {
            row["sale_id"] for row in kpis["rows"] if not row["included_in_gross_sales"]
        }

        self.assertEqual(included_ids, {11, 9, 8, 13})
        self.assertEqual(excluded_ids, {14, 15})


if __name__ == "__main__":
    unittest.main()

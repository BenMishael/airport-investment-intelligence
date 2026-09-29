"""expand airport inventory fields

Revision ID: b7c2e91a4d10
Revises: 8a51f746087f
Create Date: 2026-09-29 14:55:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7c2e91a4d10"
down_revision: Union[str, None] = "8a51f746087f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("airports") as batch:
        batch.alter_column("icao_code", existing_type=sa.String(length=4), nullable=True)
        batch.alter_column("state", existing_type=sa.String(length=2), type_=sa.String(length=16), nullable=True)
        batch.add_column(sa.Column("country_iso", sa.String(length=2), nullable=True))
        batch.add_column(sa.Column("country_name", sa.String(length=80), nullable=True))
        batch.add_column(sa.Column("kpi_tier", sa.String(length=32), nullable=False, server_default="identity"))
        batch.add_column(sa.Column("airport_type", sa.String(length=40), nullable=True))
        batch.add_column(sa.Column("continent", sa.String(length=2), nullable=True))
    op.create_index("ix_airports_country_iso", "airports", ["country_iso"])
    op.create_index("ix_airports_kpi_tier", "airports", ["kpi_tier"])


def downgrade() -> None:
    op.drop_index("ix_airports_kpi_tier", table_name="airports")
    op.drop_index("ix_airports_country_iso", table_name="airports")
    with op.batch_alter_table("airports") as batch:
        batch.drop_column("continent")
        batch.drop_column("airport_type")
        batch.drop_column("kpi_tier")
        batch.drop_column("country_name")
        batch.drop_column("country_iso")
        batch.alter_column("state", existing_type=sa.String(length=16), type_=sa.String(length=2), nullable=False)
        batch.alter_column("icao_code", existing_type=sa.String(length=4), nullable=False)

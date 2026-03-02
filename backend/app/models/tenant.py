"""Tenant ORM：對應 tenants 表 (id, name)"""
from sqlalchemy import Column, String
from app.core.database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(String(100), primary_key=True, index=True)
    name = Column(String(255), nullable=False)

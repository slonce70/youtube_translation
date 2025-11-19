#!/usr/bin/env python3
"""
Script to verify and fix asset storage paths in the database.
Checks if files exist and updates storage_path if needed.

Usage:
    python scripts/verify_asset_paths.py [--fix] [--user-id USER_ID]
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from typing import List, Tuple

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.database import Asset

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


async def verify_assets(session: AsyncSession, user_id: str | None = None, fix: bool = False) -> Tuple[int, int, int]:
    """
    Verify all assets and optionally fix invalid paths.
    
    Returns:
        (total_assets, valid_assets, fixed_assets)
    """
    query = select(Asset)
    if user_id:
        from uuid import UUID
        query = query.where(Asset.user_id == UUID(user_id))
    
    result = await session.execute(query)
    assets: List[Asset] = result.scalars().all()
    
    total = len(assets)
    valid = 0
    fixed = 0
    
    logger.info(f"Checking {total} assets...")
    
    for asset in assets:
        storage_path = Path(asset.storage_path)
        
        if storage_path.exists():
            valid += 1
            continue
        
        # Try to find the file by searching in user's upload directory
        if fix:
            user_dir = Path(settings.upload_dir) / str(asset.user_id)
            if not user_dir.exists():
                logger.warning(f"User directory not found for asset {asset.id}: {user_dir}")
                continue
            
            # Search for file by name
            found_files = list(user_dir.glob(f"**/{storage_path.name}"))
            if len(found_files) == 1:
                new_path = found_files[0].resolve()
                logger.info(f"Found file for asset {asset.id}: {new_path}")
                asset.storage_path = str(new_path)
                fixed += 1
            elif len(found_files) > 1:
                logger.warning(f"Multiple files found for asset {asset.id}, skipping")
            else:
                logger.error(f"Could not find file for asset {asset.id} ({asset.filename})")
        else:
            logger.error(f"Invalid path for asset {asset.id} ({asset.filename}): {storage_path}")
    
    if fix and fixed > 0:
        await session.commit()
        logger.info(f"Fixed {fixed} assets")
    
    return total, valid, fixed


async def main():
    parser = argparse.ArgumentParser(description="Verify asset storage paths")
    parser.add_argument("--fix", action="store_true", help="Attempt to fix invalid paths")
    parser.add_argument("--user-id", type=str, help="Only check assets for specific user")
    args = parser.parse_args()
    
    # Convert postgres:// to postgresql+asyncpg://
    db_url = settings.database_url
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    
    engine = create_async_engine(db_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as session:
        total, valid, fixed = await verify_assets(session, args.user_id, args.fix)
        
        invalid = total - valid - fixed
        logger.info(f"\nResults:")
        logger.info(f"  Total assets: {total}")
        logger.info(f"  Valid paths: {valid}")
        logger.info(f"  Fixed paths: {fixed}")
        logger.info(f"  Invalid paths: {invalid}")
        
        if invalid > 0:
            logger.warning(f"\n{invalid} assets have invalid storage paths!")
            if not args.fix:
                logger.info("Run with --fix to attempt automatic repair")
            return 1
        
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

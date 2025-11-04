#!/usr/bin/env python3
"""
Create Admin User
"""

import asyncio
import sys
from pathlib import Path
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

sys.path.insert(0, str(Path(__file__).parent))
from app.core.config import settings


async def main():
    """Create admin user"""
    print("=" * 60)
    print("👤 Creating Admin User")
    print("=" * 60)
    
    # Create async engine
    database_url = settings.database_url.replace('postgresql://', 'postgresql+asyncpg://')
    engine = create_async_engine(database_url, echo=False)
    
    async with engine.begin() as conn:
        # Get all users
        result = await conn.execute(text("""
            SELECT user_id, email, is_admin 
            FROM user_profiles 
            ORDER BY created_at
        """))
        users = result.all()
        
        print(f"\nFound {len(users)} user(s):")
        for i, (user_id, email, is_admin) in enumerate(users, 1):
            status = "👑 ADMIN" if is_admin else "👤 USER"
            print(f"   {i}. {email} - {status}")
        
        # Find the first user (owner)
        if users:
            first_user = users[0]
            user_id, email, is_admin = first_user
            
            if not is_admin:
                print(f"\n✨ Making {email} an admin...")
                await conn.execute(text("""
                    UPDATE user_profiles 
                    SET is_admin = TRUE 
                    WHERE user_id = :user_id
                """), {"user_id": user_id})
                await conn.commit()
                print(f"✅ {email} is now an admin!")
            else:
                print(f"\n✅ {email} is already an admin!")
        
        # Verify
        print("\n📊 Final admin status:")
        result = await conn.execute(text("""
            SELECT email, is_admin, subscription_tier 
            FROM user_profiles 
            WHERE is_admin = TRUE
        """))
        admins = result.all()
        for email, is_admin, tier in admins:
            print(f"   👑 {email} ({tier} tier)")
    
    print("\n" + "=" * 60)
    print("✅ Admin Setup Complete!")
    print("=" * 60)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

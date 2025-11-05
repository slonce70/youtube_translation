#!/usr/bin/env python3
"""Script to grant admin rights to a user."""
import asyncio
import sys
from sqlalchemy import select, update, text

from app.models.database import UserProfile
from app.core.database import async_session_maker, engine


async def check_and_update_admin(email: str):
    async with async_session_maker() as session:
        # Find user by email
        result = await session.execute(
            select(UserProfile).where(UserProfile.email == email)
        )
        user = result.scalar_one_or_none()
        
        if user:
            print(f"✅ Found user: {user.email}")
            print(f"   User ID: {user.user_id}")
            print(f"   Current is_admin: {user.is_admin}")
            
            if not user.is_admin:
                # Update to admin
                await session.execute(
                    update(UserProfile)
                    .where(UserProfile.email == email)
                    .values(is_admin=True)
                )
                await session.commit()
                print(f"✅ Updated user to admin!")
            else:
                print(f"✅ User already has admin rights")
        else:
            print(f"❌ User {email} not found in user_profiles")
            # Check if exists in auth
            result = await session.execute(
                text("SELECT id, email FROM auth.users WHERE email = :email"),
                {"email": email}
            )
            auth_user = result.fetchone()
            if auth_user:
                print(f"✅ User exists in auth.users with ID: {auth_user[0]}")
                print(f"   Creating user_profile with admin rights...")
                # Insert new profile
                await session.execute(
                    text("""
                        INSERT INTO user_profiles (user_id, email, is_admin, subscription_tier)
                        VALUES (:user_id, :email, true, 'free')
                    """),
                    {"user_id": auth_user[0], "email": auth_user[1]}
                )
                await session.commit()
                print(f"✅ Created admin profile!")
            else:
                print(f"❌ User not found in auth.users either")

    await engine.dispose()


if __name__ == "__main__":
    email = sys.argv[1] if len(sys.argv) > 1 else "admin@example.com"
    asyncio.run(check_and_update_admin(email))

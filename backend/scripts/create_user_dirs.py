#!/usr/bin/env python3
"""
Create User Directories - Set up file storage structure

This script creates upload directories for all users in the database.
Run after migrations to set up proper file isolation.
"""

import asyncio
import sys
from pathlib import Path
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import settings


async def main():
    """Create user directories"""
    print("=" * 60)
    print("📁 Creating User Directories")
    print("=" * 60)
    
    # Setup paths (use local path for development)
    backend_dir = Path(__file__).parent.parent
    upload_dir = backend_dir / "uploads"
    temp_dir = upload_dir / "_temp"
    
    print(f"\n📂 Backend directory: {backend_dir}")
    print(f"📂 Upload directory: {upload_dir}")
    print(f"📂 Temp directory: {temp_dir}")
    
    # Create base directories
    upload_dir.mkdir(parents=True, exist_ok=True)
    temp_dir.mkdir(parents=True, exist_ok=True)
    print("\n✅ Created base directories")
    
    # Create async engine
    database_url = settings.database_url.replace('postgresql://', 'postgresql+asyncpg://')
    engine = create_async_engine(database_url, echo=False)
    
    async with engine.begin() as conn:
        # Get all users
        result = await conn.execute(text("""
            SELECT user_id, email FROM user_profiles ORDER BY created_at
        """))
        users = result.all()
        
        if not users:
            print("\n⚠️  No users found in database!")
            print("   Create users first, then run this script.")
            return
        
        print(f"\n👥 Found {len(users)} user(s):")
        
        # Create directory for each user
        created = 0
        existed = 0
        
        for user_id, email in users:
            user_dir = upload_dir / str(user_id)
            
            if user_dir.exists():
                print(f"   ⏭️  {email}: directory already exists")
                existed += 1
            else:
                user_dir.mkdir(parents=True, exist_ok=True)
                # Set restrictive permissions (owner only)
                user_dir.chmod(0o700)
                print(f"   ✅ {email}: created {user_dir}")
                created += 1
        
        print(f"\n📊 Summary:")
        print(f"   Created: {created}")
        print(f"   Already existed: {existed}")
        print(f"   Total: {len(users)}")
    
    # Show final structure
    print(f"\n📁 Final structure:")
    print(f"   {upload_dir}/")
    print(f"   ├── _temp/              (temporary uploads)")
    for user_id, email in users:
        print(f"   ├── {user_id}/    ({email})")
    
    print("\n" + "=" * 60)
    print("✅ User Directories Created Successfully!")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Configure tusd to use these directories")
    print("2. Test file upload with quota checks")
    print("3. Verify file isolation")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

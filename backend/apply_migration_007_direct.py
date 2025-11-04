#!/usr/bin/env python3
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import psycopg2
from urllib.parse import urlparse

# Load environment
load_dotenv()

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_KEY")

# For direct PostgreSQL connection, we need DATABASE_URL
db_url = os.getenv("DATABASE_URL")
if not db_url:
    print("❌ DATABASE_URL not found in .env")
    print("Migration 007 needs to be applied manually through Supabase SQL Editor")
    print("\nTo apply manually:")
    print("1. Go to https://jljcchkpowprgqslxhac.supabase.co")
    print("2. Open SQL Editor")
    print("3. Copy contents of backend/migrations/007_remove_projects.sql")
    print("4. Execute the SQL")
    sys.exit(1)

print("=" * 80)
print("🚀 Applying Migration 007: Remove Projects")
print("=" * 80)

# Read migration
migration_file = Path("migrations/007_remove_projects.sql")
with open(migration_file, "r") as f:
    sql = f.read()

print(f"\n📄 Migration file: {migration_file}")
print(f"📏 SQL length: {len(sql)} characters\n")

try:
    # Connect to database
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor()
    
    print("🔄 Executing migration SQL...\n")
    
    # Execute the entire migration
    cur.execute(sql)
    
    conn.commit()
    
    print("\n" + "=" * 80)
    print("✅ Migration 007 applied successfully!")
    print("=" * 80)
    print("\nChanges:")
    print("  • Dropped project_id column from assets table")
    print("  • Dropped project_id column from playlists table")
    print("  • Dropped project_id column from destinations table")
    print("  • Dropped project_id column from streams table")
    print("  • Dropped projects table")
    
    cur.close()
    conn.close()
    
except Exception as e:
    print(f"\n❌ Error applying migration: {e}")
    import traceback
    traceback.print_exc()
    if 'conn' in locals():
        conn.rollback()
        conn.close()
    sys.exit(1)

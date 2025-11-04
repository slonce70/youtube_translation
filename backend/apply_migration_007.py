#!/usr/bin/env python3
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

# Load environment
load_dotenv()

url = os.getenv("SUPABASE_URL")
service_role_key = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not url or not service_role_key:
    print("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env")
    sys.exit(1)

print("=" * 80)
print("🚀 Applying Migration 007: Remove Projects")
print("=" * 80)

# Create Supabase client
supabase = create_client(url, service_role_key)

# Read migration
migration_file = Path("migrations/007_remove_projects.sql")
with open(migration_file, "r") as f:
    sql = f.read()

print(f"\n📄 Migration file: {migration_file}")
print(f"📏 SQL length: {len(sql)} characters\n")

try:
    # Split SQL into individual statements
    statements = [stmt.strip() for stmt in sql.split(";") if stmt.strip() and not stmt.strip().startswith("--")]
    
    print(f"🔄 Executing {len(statements)} SQL statements...\n")
    
    for i, stmt in enumerate(statements, 1):
        # Skip DO blocks (they're complete statements)
        if "DO $$" in stmt:
            print(f"  {i}. Executing verification block...")
            result = supabase.rpc("exec_sql", {"sql": stmt + ";"}).execute()
            print(f"     ✅ Done")
        elif stmt.startswith("ALTER TABLE") or stmt.startswith("DROP TABLE"):
            # Extract table name for display
            parts = stmt.split()
            table_name = parts[2] if len(parts) > 2 else "unknown"
            print(f"  {i}. {parts[0]} {parts[1]} {table_name}...")
            result = supabase.rpc("exec_sql", {"sql": stmt + ";"}).execute()
            print(f"     ✅ Done")
        else:
            print(f"  {i}. Executing: {stmt[:60]}...")
            result = supabase.rpc("exec_sql", {"sql": stmt + ";"}).execute()
            print(f"     ✅ Done")
    
    print("\n" + "=" * 80)
    print("✅ Migration 007 applied successfully!")
    print("=" * 80)
    print("\nChanges:")
    print("  • Dropped project_id column from assets table")
    print("  • Dropped project_id column from playlists table")
    print("  • Dropped project_id column from destinations table")
    print("  • Dropped project_id column from streams table")
    print("  • Dropped projects table")
    
except Exception as e:
    print(f"\n❌ Error applying migration: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

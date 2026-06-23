from services.supabase_client import get_supabase_client
import os
from dotenv import load_dotenv

load_dotenv()
url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
client = get_supabase_client(url, key)

try:
    res = client.table("survey_contexts").select("*").limit(1).execute()
    print("SUCCESS: Table survey_contexts exists! Result:", res)
except Exception as e:
    print("ERROR: Table survey_contexts does not exist or error occurred:", e)

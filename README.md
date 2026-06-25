## Project Structure
The repository is split into two main decoupled services:
* `/api` — The Flask Python backend API responsible for parsing Excel workbooks, calculating survey metrics, running search queries, and generating AI insights.
* `/frontend` — The Next.js React frontend containing interactive charts, client routing, and the admin/workspace dashboard.
* `/supabase` — Local database migrations and configuration.

---

## Prerequisites
* **Python 3.10+** (with `pip` and `venv`)
* **Node.js 18+** (with `npm`)
* **Supabase Project** (Database & Auth setup)

---

## Local Setup Guide

### 1. Backend Setup (Flask API)
1. **Navigate to the API folder:**
   ```bash
   cd api
   ```
2. **Create a virtual environment:**
   ```bash
   python -m venv venv
   ```
3. **Activate the virtual environment:**
   * **Windows (PowerShell):** `.\venv\Scripts\Activate.ps1`
   * **macOS/Linux:** `source venv/bin/activate`
4. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
5. **Create the environment file (`api/.env`):**
   Copy the following variables and insert your active credentials:
   ```ini
   SUPABASE_URL="https://your-project.supabase.co"
   SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
   SUPABASE_JWT_SECRET="your-jwt-signing-secret"
   ALLOWED_ORIGINS="http://localhost:3000,http://localhost:3001"
   NVIDIA_API_KEY="nvapi-..."
   TAVILY_API_KEY="tvly-..."
   FLASK_DEBUG="true"
   ```
6. **Start the API server:**
   ```bash
   python app.py
   ```
   The backend will start running locally at `http://localhost:5000`.

---

### 2. Frontend Setup (Next.js)
1. **Navigate to the frontend folder:**
   ```bash
   cd ../frontend
   ```
2. **Install node modules:**
   ```bash
   npm install
   ```
3. **Create the environment file (`frontend/.env.local`):**
   Copy the following variables and insert your active credentials:
   ```ini
   NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
   NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
   NEXT_PUBLIC_API_URL="http://localhost:5000"
   NEXT_PUBLIC_APP_URL="http://localhost:3000"
   SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
   ```
4. **Start the Next.js development server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your web browser.

---

## Running Backend Unit Tests
To run the Python pytest suite:
1. Ensure your backend virtual environment is active.
2. Run `pytest` from the `/api` directory:
   ```bash
   cd api
   pytest
   ```

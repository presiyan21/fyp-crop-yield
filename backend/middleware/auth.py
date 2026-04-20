from functools import wraps
from flask import request, jsonify, g
import os
from supabase import create_client

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing Authorization header"}), 401

        token = auth_header[7:]
        try:
            sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_KEY"))
            user_response = sb.auth.get_user(token)
            g.user_id    = user_response.user.id
            g.user_email = user_response.user.email
        except Exception:
            return jsonify({"error": "Invalid or expired token"}), 401

        return f(*args, **kwargs)
    return decorated
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Loader2, Sprout } from "lucide-react";

export default function Login() {
  const [mode, setMode]         = useState("signin");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [message, setMessage]   = useState(null);
  const { signIn, signUp }      = useAuth();
  const navigate                = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(null); setMessage(null);
    try {
      if (mode === "signin") {
        await signIn(email, password);
        navigate("/");
      } else {
        await signUp(email, password);
        setMessage("Account created — check your email to confirm, then sign in.");
        setMode("signin");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mb-3">
            <Sprout size={24} className="text-emerald-600" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">CropAdvisor</h1>
          <p className="text-sm text-slate-500 mt-1">ML-powered crop yield advisory</p>
        </div>

        <div className="bg-white border rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-medium mb-4">
            {mode === "signin" ? "Sign in to your account" : "Create an account"}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-600 mb-1">Email</label>
              <input type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full p-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="you@example.com" />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">Password</label>
              <input type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="••••••••" />
            </div>
            {error   && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
            {message && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">{message}</div>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-slate-800 text-white rounded-lg font-medium
                         hover:bg-slate-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {loading && <Loader2 size={16} className="animate-spin" />}
              {mode === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500">
            {mode === "signin" ? (
              <>No account?{" "}
                <button onClick={() => setMode("signup")} className="text-emerald-600 hover:underline font-medium">Sign up</button>
              </>
            ) : (
              <>Have an account?{" "}
                <button onClick={() => setMode("signin")} className="text-emerald-600 hover:underline font-medium">Sign in</button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider }    from "./context/AuthContext";
import ProtectedRoute      from "./components/ProtectedRoute";
import ErrorBoundary       from "./components/ErrorBoundary";
import Navbar              from "./components/Navbar";
import Dashboard           from "./pages/Dashboard";
import Models              from "./pages/Models";
import About               from "./pages/About";
import History             from "./pages/History";
import Login               from "./pages/Login";
import Settings            from "./pages/Settings";
import Admin               from "./pages/Admin";
import CropRanker          from "./pages/CropRanker";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <div className="min-h-screen bg-slate-50 text-slate-900">
                <Navbar />
                <main className="p-6">
                  <ErrorBoundary>
                    <Routes>
                      <Route path="/"         element={<Dashboard />} />
                      <Route path="/predict"  element={<Dashboard />} />
                      <Route path="/models"   element={<Models />}    />
                      <Route path="/history"  element={<History />}   />
                      <Route path="/settings" element={<Settings />}  />
                      <Route path="/about"    element={<About />}     />
                      <Route path="/admin"    element={<Admin />}     />
                      <Route path="/ranker"   element={<CropRanker />} />
                    </Routes>
                  </ErrorBoundary>
                </main>
              </div>
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
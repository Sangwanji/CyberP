import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';

export default function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <nav className="border-b border-cyber-line bg-cyber-panel/90 px-4 py-4 shadow-glow">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <Link to="/" className="text-xl font-black tracking-widest text-cyber-accent">
          CYBERP
        </Link>
        <div className="flex items-center gap-6">
          <Link to="/" className="text-sm font-semibold text-cyber-text hover:text-cyber-accent">
            Scanner
          </Link>
          {user ? (
            <>
              <Link
                to="/dashboard"
                className="text-sm font-semibold text-cyber-text hover:text-cyber-accent"
              >
                Dashboard
              </Link>
              <button
                onClick={() => void handleLogout()}
                className="text-sm font-semibold text-cyber-muted hover:text-red-400"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="text-sm font-semibold text-cyber-text hover:text-cyber-accent"
              >
                Login
              </Link>
              <Link
                to="/signup"
                className="rounded-full bg-cyber-accent px-4 py-2 text-sm font-semibold text-cyber-bg hover:bg-cyber-accentSoft"
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

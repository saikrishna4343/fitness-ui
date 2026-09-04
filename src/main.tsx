import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { AppShell } from '@/components/AppShell'
import { ThemeProvider } from '@/components/ThemeProvider'
import { Toaster } from '@/components/ui/sonner'
import { ApiError } from '@/lib/api'
import Dashboard from '@/pages/Dashboard'
import FoodLog from '@/pages/FoodLog'
import Login from '@/pages/Login'
import Plan from '@/pages/Plan'
import Progress from '@/pages/Progress'
import Settings from '@/pages/Settings'
import Timer from '@/pages/Timer'
import SignUp from '@/pages/SignUp'
import Workout from '@/pages/Workout'
import '@/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // An expired session will not fix itself by retrying.
      retry: (failureCount, error) =>
        error instanceof ApiError && error.status === 401 ? false : failureCount < 2,
    },
  },
})

function ProtectedRoute() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="grid min-h-svh place-items-center text-sm text-muted-foreground">Loading…</div>
    )
  }
  return session ? <Outlet /> : <Navigate to="/login" replace />
}

/**
 * There is no request mocking in this app. This only removes a service worker left
 * registered by the MSW setup that used to live in src/mocks/ — until it is gone it
 * keeps intercepting requests, which hides real API errors from the Network tab.
 */
async function removeStaleMockWorker() {
  if (!('serviceWorker' in navigator)) return
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(
    registrations
      .filter((registration) => registration.active?.scriptURL.includes('mockServiceWorker'))
      .map(async (registration) => {
        await registration.unregister()
        console.warn('[mocks] Unregistered a leftover mock service worker — reload once.')
      }),
  )
}

void removeStaleMockWorker().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<SignUp />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppShell />}>
                    <Route index element={<Dashboard />} />
                    <Route path="food" element={<FoodLog />} />
                    <Route path="workout" element={<Workout />} />
                    <Route path="plan" element={<Plan />} />
                    <Route path="timer" element={<Timer />} />
                    <Route path="progress" element={<Progress />} />
                    <Route path="settings" element={<Settings />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthProvider>
            <Toaster richColors position="top-center" />
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  )
})

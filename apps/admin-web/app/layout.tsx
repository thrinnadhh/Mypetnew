import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'MyPet Admin',
  description: 'Permission-scoped MyPetNew operations'
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <main className="shell">
          <header>
            <h1>MyPet Admin</h1>
            <p className="muted">Canonical operations only—no direct status, money, stock, or loyalty edits.</p>
            <nav aria-label="Admin sections" className="nav">
              <Link href="/">Overview</Link>
              <Link href="/providers">Provider review</Link>
            </nav>
          </header>
          {children}
        </main>
      </body>
    </html>
  )
}


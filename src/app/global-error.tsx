"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html>
      <body className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold">Something went wrong</h1>
          <p className="mb-4 text-muted-foreground text-sm">{error.message}</p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

import { screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, ErrorBoundary, ErrorState } from '../src/index.js';
import { renderUi } from './render.js';

const broken = { on: true };

function Fragile() {
  if (broken.on) throw new Error('A screen bug');
  return <p>Working</p>;
}

function Screen({ onError }: { onError?: (error: unknown) => void }) {
  const [address, setAddress] = useState('/a');
  return (
    <>
      <Button
        onClick={() => {
          setAddress('/b');
        }}
      >
        Move
      </Button>
      <ErrorBoundary
        resetKey={address}
        {...(onError !== undefined && { onError })}
        fallback={(retry) => (
          <ErrorState title="This screen stopped" retryLabel="Try again" onRetry={retry} />
        )}
      >
        <Fragile />
      </ErrorBoundary>
    </>
  );
}

describe('[NFR-U04] ErrorBoundary (QA audit, category A)', () => {
  it('shows its fallback instead of blanking the app, reports the error, and retries', async () => {
    broken.on = true;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    const { user } = renderUi(<Screen onError={onError} />);
    expect(screen.getByText('This screen stopped')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move' })).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'A screen bug' }));
    broken.on = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Working')).toBeInTheDocument();
    quiet.mockRestore();
  });

  it('recovers when the address changes', async () => {
    broken.on = true;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = renderUi(<Screen />);
    expect(screen.getByText('This screen stopped')).toBeInTheDocument();
    broken.on = false;
    await user.click(screen.getByRole('button', { name: 'Move' }));
    expect(screen.getByText('Working')).toBeInTheDocument();
    quiet.mockRestore();
  });
});

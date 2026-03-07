import { getData } from '@/lib/actions/actions';
import { describe, it, expect, vi } from 'vitest';

// Mock the neon database connection
vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => vi.fn().mockResolvedValue([{ id: 1, name: 'Test Data' }])),
}));

describe('Server Actions', () => {
  it('getData should return mocked data from neon database', async () => {
    const data = await getData();
    expect(data).toEqual([{ id: 1, name: 'Test Data' }]);
  });
});

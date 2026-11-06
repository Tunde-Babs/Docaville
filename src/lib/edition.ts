/** Beta access is explicit; a preview is never evidence of a paid entitlement. */
export function releaseEdition(channel = 'beta') {
  if (channel === 'beta') return { channel, canEdit: true, label: 'Beta · Pro included' } as const;
  if (channel === 'free-preview') return { channel, canEdit: false, label: 'Free viewer preview' } as const;
  throw new Error('Store release is not configured. Complete verified purchase and restoration setup before enabling commercial distribution.');
}

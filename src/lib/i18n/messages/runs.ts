/** runs message dictionary. Arabic source of truth; English mirrors key-for-key. */
export const runsAr = {} as const;

export const runsEn: Record<keyof typeof runsAr, string> = {};

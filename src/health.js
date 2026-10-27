// Daily health tracker: water goal and supplements, with the time each one is due.
export const HEALTH = {
  water: { goal: 8, unit: 'glasses', glassOz: 8, start: 8, end: 22 }, // spread the goal over 8am–10pm
  supplements: [
    { id: 'multi', name: 'Multivitamin', dose: '1 tablet', at: '09:00' },
    { id: 'mag', name: 'Magnesium', dose: '200 mg', at: '21:00' },
    // { id: 'vitd', name: 'Vitamin D3', dose: '2000 IU', at: '09:00' },
    // { id: 'omega', name: 'Omega-3', dose: '1000 mg', at: '13:00' },
  ],
};

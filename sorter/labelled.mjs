// The small labelled set for the sorter trial: the eight support texts RentAPlace seeds, plus eight written for
// this trial (money with no money word, a money word with no money, an owner that is neither).
// owner: who looks first. An array means either answer is accepted (the ticket is honestly on a border).
// money: true when the ticket is about money moving or owed (a refund, a charge, a payout, a price, compensation, a deposit).
export const TICKETS = [
  { id: 'seed-1', subject: 'Refund timing', message: 'I cancelled a flexible stay yesterday. When will the refund show up?', owner: 'pricing', money: true },
  { id: 'seed-2', subject: 'Unable to find my confirmation', message: 'I booked a cabin but cannot find the confirmation in my inbox.', owner: 'booking', money: false },
  { id: 'seed-3', subject: 'Calendar is slow to respond', message: 'The calendar takes a while to react when I move between dates.', owner: 'nobody', money: false },
  { id: 'seed-4', subject: 'Pet policy question', message: 'Does the pet-friendly amenity include two small dogs?', owner: 'nobody', money: false },
  { id: 'seed-5', subject: 'Payout date question', message: 'My guest checked in yesterday. When is the payout scheduled?', owner: 'pricing', money: true },
  { id: 'seed-6', subject: 'Update my arrival time', message: 'We will arrive after 9 pm. How do I let the host know?', owner: 'booking', money: false },
  { id: 'seed-7', subject: 'Closed listing still available', message: 'The Beach House looks closed but I can still open its checkout.', owner: ['booking', 'nobody'], money: false },
  { id: 'seed-8', subject: 'Holiday booking length', message: 'Can I require longer stays for the holiday period starting November 16?', owner: ['booking', 'nobody'], money: false },
  { id: 'new-1', subject: 'Two lines on my statement', message: 'My card shows the same weekend at Pine Hollow twice.', owner: 'pricing', money: true },
  { id: 'new-2', subject: 'Still waiting', message: 'I cancelled last Tuesday and nothing has come back to my card yet.', owner: 'pricing', money: true },
  { id: 'new-3', subject: 'Parking', message: 'Is the street parking outside the Old Mill Loft free, or do I need a permit?', owner: 'nobody', money: false },
  { id: 'new-4', subject: 'Total looks wrong', message: 'The total at checkout was more than three times the nightly rate. What are the extra amounts?', owner: 'pricing', money: true },
  { id: 'new-5', subject: 'Host has not answered', message: 'I requested a stay two days ago and it still says pending. Did the host see it?', owner: 'booking', money: false },
  { id: 'new-6', subject: 'Nothing arrived', message: 'I hosted a family last week and my bank shows nothing from you.', owner: 'pricing', money: true },
  { id: 'new-7', subject: 'Host wants a transfer', message: 'The host is asking me to send a security deposit by bank transfer before arrival. Is that normal?', owner: ['nobody', 'pricing'], money: true },
  { id: 'new-8', subject: 'Broken heating', message: 'The heating was broken the whole stay. I think you owe me something for that.', owner: ['pricing', 'nobody'], money: true },
];

// A second labelled set, written AFTER the Jev bars (sorter/jev.mjs) were chosen from the first set and BEFORE any
// run on these tickets. The labels were committed in their own commit before the first run and are not changed after.
// It covers kinds the first set lacks: a date change that changes the price, "how much do I get back if I cancel",
// a declined card, a host's damage claim, money said with no money word, money words with no money at stake.
// owner: who looks first; an array means either answer is accepted (the ticket is honestly on a border).
// money: true when the ticket is about money moving or owed (a refund, a charge, a payout, a price or total, compensation, a deposit).
export const TICKETS = [
  // a date change that changes the price
  { id: 'f-01', kind: 'date change, price changes', subject: 'Move my stay', message: 'I need to move my stay at Cedar Ridge from the 14th to the weekend of the 21st. Will the total change, and do I pay the difference now?', owner: ['booking', 'pricing'], money: true },
  { id: 'f-02', kind: 'date change, price changes', subject: 'Adding a night', message: 'Can I add Sunday night to my confirmed stay at the Lake Cabin? What would the extra night come to?', owner: ['booking', 'pricing'], money: true },
  // how much do I get back if I cancel
  { id: 'f-03', kind: 'cancel, how much back', subject: 'Thinking of cancelling', message: 'If I cancel my stay at Harbor View today, how much do I get back?', owner: 'pricing', money: true },
  { id: 'f-04', kind: 'cancel, how much back', subject: 'Cancellation terms', message: 'My stay starts in five days and the listing says moderate. What would I lose if I pull out now?', owner: 'pricing', money: true },
  // a declined card
  { id: 'f-05', kind: 'declined card', subject: 'Card declined', message: 'My card was declined at checkout twice, but my bank says there is nothing wrong on their side.', owner: ['pricing', 'booking'], money: true },
  { id: 'f-06', kind: 'declined card', subject: 'Payment did not go through', message: 'It says payment failed, yet I see a pending amount from you in my banking app.', owner: 'pricing', money: true },
  // a host's damage claim
  { id: 'f-07', kind: 'damage claim', subject: 'Guest broke the coffee table', message: 'The guests who left on Sunday broke the glass coffee table. How do I claim the cost of replacing it?', owner: ['pricing', 'nobody'], money: true },
  { id: 'f-08', kind: 'damage claim', subject: 'Being blamed for a stain', message: 'The host says I ruined a rug and wants me to cover it. I did not do it. What happens now?', owner: ['pricing', 'nobody'], money: true },
  // money, with no money word, said several different ways
  { id: 'f-09', kind: 'money, no money word', subject: 'Taken twice', message: 'You took it out of my account on Monday and then again on Wednesday for one stay.', owner: 'pricing', money: true },
  { id: 'f-10', kind: 'money, no money word', subject: 'Where is it', message: 'The family left nine days ago and my account is still empty.', owner: 'pricing', money: true },
  { id: 'f-11', kind: 'money, no money word', subject: 'Shortchanged', message: 'Guests stayed four nights last month and what landed was for three.', owner: 'pricing', money: true },
  { id: 'f-12', kind: 'money, no money word', subject: 'The place was filthy', message: 'We left after one night because the place was filthy. We should not be out of pocket for the other three.', owner: ['pricing', 'nobody'], money: true },
  { id: 'f-13', kind: 'money, no money word', subject: 'Came to more than shown', message: 'The listing said 120 a night for two nights, and 310 left my account.', owner: 'pricing', money: true },
  // money words, with no money at stake
  { id: 'f-14', kind: 'money word, no money', subject: 'Listing wording', message: "My listing title says 'Rich in character, priceless views'. Can I change the title after publishing?", owner: 'nobody', money: false },
  { id: 'f-15', kind: 'money word, no money', subject: 'Safe in the unit', message: 'Is there a safe in the Old Mill Loft where we can leave passports and some cash while we hike?', owner: 'nobody', money: false },
  { id: 'f-16', kind: 'money word, no money', subject: 'Worth every penny', message: 'Our stay at Pine Hollow was worth every penny. How do I leave the host a review?', owner: 'nobody', money: false },
  { id: 'f-17', kind: 'money word, no money', subject: 'Arrival on Friday', message: 'We have paid in full and everything is confirmed. What time can we arrive on Friday?', owner: 'booking', money: false },
  // clear booking
  { id: 'f-18', kind: 'clear booking', subject: 'Wrong dates on my reservation', message: 'My confirmation shows the 3rd to the 5th but I picked the 4th to the 6th. Can you correct it?', owner: 'booking', money: false },
  { id: 'f-19', kind: 'clear booking', subject: 'Is it confirmed?', message: 'I got an email saying my request was received, but nothing since. Is my stay confirmed or not?', owner: 'booking', money: false },
  { id: 'f-20', kind: 'clear booking', subject: 'Host declined', message: 'The host declined my request with no reason. Can I ask again for the same dates?', owner: 'booking', money: false },
  // clear nobody
  { id: 'f-21', kind: 'clear nobody', subject: 'Wifi speed', message: 'Does the Lake Cabin have wifi fast enough for video calls?', owner: 'nobody', money: false },
  { id: 'f-22', kind: 'clear nobody', subject: 'Cannot log in', message: 'The password reset email never arrives, so I cannot get into my account.', owner: 'nobody', money: false },
  // honest border cases
  { id: 'f-23', kind: 'border', subject: 'Host cancelled on me', message: 'The host cancelled two days before arrival. What happens to what I paid, and can you find me somewhere else?', owner: ['booking', 'pricing'], money: true },
  { id: 'f-24', kind: 'border', subject: 'Smoke alarm', message: 'The smoke alarm in the unit has no battery. The host is not answering and we arrive tomorrow.', owner: ['nobody', 'booking'], money: false },
];

export const ANSWER_KEY = [
  {
    id: "k-01",
    kind: "double charge, no money word",
    subject: "Seeing double",
    message:
      "My card statement shows the same weekend at Pine Hollow twice. I only booked it once.",
    owner: "pricing",
    money: true,
  },
  {
    id: "k-02",
    kind: "money word, no money",
    subject: "Parking",
    message:
      "Is street parking free near the Lakeside A-Frame, or should we look for a garage?",
    owner: "nobody",
    money: false,
  },
  {
    id: "k-03",
    kind: "slow site",
    subject: "Calendar is slow",
    message:
      "The availability calendar takes forever to load on my phone. Is something wrong?",
    owner: "nobody",
    money: false,
  },
  {
    id: "k-04",
    kind: "broken heating, wants compensation",
    subject: "Freezing all weekend",
    message:
      "The heating never worked during our stay. It was miserable and I think we are owed something for it.",
    owner: ["nobody", "pricing"],
    money: true,
  },
  {
    id: "k-05",
    kind: "plain date change",
    subject: "Arrive a day later",
    message:
      "Can we push our arrival at Cedar Ridge back one day and keep the same checkout?",
    owner: "booking",
    money: false,
  },
  {
    id: "k-06",
    kind: "date change, price changes",
    subject: "Extend the trip",
    message:
      "We want to add two nights to our stay. How much more will that be, and when do we pay it?",
    owner: ["booking", "pricing"],
    money: true,
  },
  {
    id: "k-07",
    kind: "refund request",
    subject: "Cancelled trip",
    message:
      "I cancelled my reservation last week and have not seen my refund yet.",
    owner: "pricing",
    money: true,
  },
  {
    id: "k-08",
    kind: "host payout short, no money word",
    subject: "Missing a night",
    message:
      "My guests stayed five nights but what came through to me only covers four.",
    owner: "pricing",
    money: true,
  },
  {
    id: "k-09",
    kind: "pending status",
    subject: "Still pending",
    message:
      "My reservation has said pending for two days. Is it confirmed or not?",
    owner: "booking",
    money: false,
  },
  {
    id: "k-10",
    kind: "money word, no money",
    subject: "Check-in time",
    message:
      "Everything is paid and confirmed. What time can we check in on Saturday?",
    owner: "booking",
    money: false,
  },
  {
    id: "k-11",
    kind: "fee question",
    subject: "What is this fee",
    message:
      "Why is there a service fee on top of the nightly rate and cleaning?",
    owner: "pricing",
    money: true,
  },
  {
    id: "k-12",
    kind: "safety, border",
    subject: "Broken lock",
    message:
      "The back door lock is broken and the host is not answering. We arrive tonight.",
    owner: ["nobody", "booking"],
    money: false,
  },
  {
    id: "k-13",
    kind: "damage claim",
    subject: "Damage charge",
    message:
      "The host says we broke a table and wants us to pay for it. We did not break it.",
    owner: "nobody",
    money: true,
  },
  {
    id: "k-14",
    kind: "deposit by transfer",
    subject: "Sent the deposit",
    message:
      "I sent the deposit by bank transfer yesterday. Can you confirm you received it?",
    owner: "pricing",
    money: true,
  },
  {
    id: "k-15",
    kind: "host declined",
    subject: "Declined?",
    message:
      "The host declined my request. Can I request the same dates again or is that blocked?",
    owner: "booking",
    money: false,
  },
  {
    id: "k-16",
    kind: "amenities",
    subject: "Wifi and towels",
    message: "Does the cabin have wifi, and are towels provided?",
    owner: "nobody",
    money: false,
  },
];

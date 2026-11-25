export const FRESH_SET = [
  {
    id: "t-01",
    kind: "money in a question about dates",
    subject: "Shorter stay",
    message:
      "We can only make it for two of the four nights now. Do we get anything back for the nights we skip?",
    owner: ["booking", "pricing"],
    money: true,
  },
  {
    id: "t-02",
    kind: "money word, compliment",
    subject: "Worth every penny",
    message:
      "Just wanted to say the cabin was worth every penny. The view was amazing, thank you!",
    owner: "nobody",
    money: false,
  },
  {
    id: "t-03",
    kind: "negation, no refund wanted",
    subject: "Keep the booking",
    message:
      "I do not want a refund. I just want to confirm my reservation is still active after the host changed the photos.",
    owner: "booking",
    money: false,
  },
  {
    id: "t-04",
    kind: "host asks about tax",
    subject: "Tax on my earnings",
    message:
      "As a host, is the occupancy tax already taken out before my money arrives, or do I handle it myself?",
    owner: "pricing",
    money: true,
  },
  {
    id: "t-05",
    kind: "numbers only",
    subject: "Does this look right",
    message:
      "The listing said 120 a night. Three nights and I was billed 455. What is the extra?",
    owner: "pricing",
    money: true,
  },
  {
    id: "t-06",
    kind: "free cancellation",
    subject: "Cancel for free?",
    message:
      "If I cancel tomorrow, is it still free or will I lose part of what I paid?",
    owner: ["booking", "pricing"],
    money: true,
  },
  {
    id: "t-07",
    kind: "angry, urgent, no money",
    subject: "URGENT!!!",
    message:
      "The website logged me out three times while I was messaging the host. This is ridiculous, fix it now!",
    owner: "nobody",
    money: false,
  },
  {
    id: "t-08",
    kind: "two questions, money second",
    subject: "Late arrival",
    message: "Can we check in after 11pm? Also, will there be a fee for that?",
    owner: ["booking", "pricing"],
    money: true,
  },
];

# Reminders about cards

Intent does not remind the human about cards awaiting acceptance, a `Core` verdict or a push until the pending count reaches the threshold.

* **Threshold:** the cycle volume in `project/config/PROJECT.md` (`volume`, cards per epic). Count per epic: cards in `review` (awaiting acceptance) plus cards in `done` with `assignee: Core` (awaiting a verdict).
* **Below the threshold:** silence. No "accept?", no "shall I call `Core`?", no reminder at the end of a reply. Pending cards are named only when the human asks, or when the work itself needs the answer.
* **At the threshold:** one reminder per epic, naming the count and the cards. After it, silence until the human acts.
* **Not covered:** a stop or request under §2 ("human" row) and the start check keep their own reporting. A red `sync-engines --check` caused only by pending verdicts is reported once as a fact, not as a request.
* **Commit and push of the protocol clone** do not wait for card acceptance: they run on the human's command, independently of the board.

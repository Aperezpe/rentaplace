# Issues expectations

## A draft opens, scrolls and closes without sending anything
Do (issues): select the first issue
Expect (issues): under the selected issue the panel shows a "Question", the "Facts looked up by code" and a "Draft reply (not sent)"
Do (issues): press Enter
Expect (issues): the whole draft is open in the panel and the panel says nothing is sent
Do (issues): press the down arrow three times
Expect (issues): the highlighted line has moved down inside the draft
Do (issues): press Enter
Expect (issues): the issue list is shown again
Never (issues): anything is sent to Main, or any file under outbox/ is written

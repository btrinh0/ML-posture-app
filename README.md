# Deskframe

Deskframe is a Windows desktop companion for study sessions. Start a session, close the window to the tray, and return for movement breaks or a daily check-in. The timer uses elapsed time and the operating system’s idle duration. No keystrokes are collected. Each profile keeps its desk setup, session history, completed drills and discomfort scores in local SQLite.

## Run from source

Use Node.js 24 or later and run the following commands in the repository.

```powershell
npm.cmd ci
npm.cmd start
```

Run `npm.cmd test` for the automated checks. `npm.cmd run dist:win` builds a per-user Windows x64 installer in `release/`. The sign-in option is intended for an installed copy. The tray menu includes **Quit Deskframe**.

## Using the companion

1. Open **Desk setup**, answer three workstation questions, and choose a reminder interval of 25–40 active minutes. Each adjustment corresponds to a question. [OSHA workstation checklist](https://www.osha.gov/etools/computer-workstations/checklists/evaluation)
2. Start a session in **Study desk**. After 60 seconds of system inactivity the clock pauses. A break can be completed, snoozed for five active minutes, or skipped. Short movement breaks and changes of position are discussed in the [OSHA work process guide](https://www.osha.gov/etools/computer-workstations/work-process).
3. Log jaw, neck and upper-back discomfort once per day. Saving again edits that day’s entry. Use a separate local profile for each person.

The movement library offers optional gentle movements for desk breaks. Its references include [University Hospitals Sussex](https://www.uhsussex.nhs.uk/resources/self-treatment-of-acute-neck-pain-2/) and [Leeds Teaching Hospitals](https://www.leedsth.nhs.uk/patients/resources/shoulder-exercises/).

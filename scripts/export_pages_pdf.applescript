on run argv
    set outputPath to item 1 of argv
    tell application "Pages"
        activate
        set openedDocument to front document
        export openedDocument to POSIX file outputPath as PDF
        close openedDocument saving no
    end tell
end run

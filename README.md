# AMarverlousDisplay
A Simple Controller for a "Futaba VFD Serial Display" that is used in a very Marvelous game

## Configuration
```json
{
    "serialPort": "COM50",
    "enableAPI": true,
    "autoStart": true,
    "clock": {
        "x": 110,
        "y": 2
    },
    "initBrightness": 1,
    "initLine1": "PlayLand Gau",
    "initLine2": "Hello World, this is a default scroll line!"
}
```
* COM Port or Path
* Enable API
* Enable Auto Power On
* Sets Clock Position, if removed the clock is disabled and can not be used
* Initial Brightness of Display
* Initial Line 1 and 2

## API Endpoints
### Power On - /powerOn
Enable Power Supply

### Power Off - /powerOff
Disable Power Supply

### Reset - /reset
Resets the Display and does not set any lines

### Enable Clock - /enableClock
Enable Clock Display and Updates

### Disable Clock - /disableClock
Disable Clock Display and Updates, does not clear display so send another status

### Set Line 1 - /setHeader
Requires Text Query - Sets the First Line of the Display (No Auto Scroll Detection)

### Set Line 2 - /setStatus
Requires Text Query - Sets the Last Line of the Display (Auto Scroll Detection)

### Set Text Manually - /setText
Requires Text Query - Sets text to any position with optional parameters that can be found in the code

### Set Raw Bytes - /setRaw
Requires Bytes Query - Sets raw bytes to any position with optional parameters that can be found in the code


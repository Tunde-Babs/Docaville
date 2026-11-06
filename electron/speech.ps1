Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $data = [Console]::In.ReadLine() | ConvertFrom-Json
    $synth.SelectVoice($data.voice)
    $synth.Rate = $data.rate
    $null = $synth.SpeakAsync($data.text)
    Start-Sleep -Milliseconds 80
    $inputTask = [Console]::In.ReadLineAsync()
    while ($synth.State -ne [System.Speech.Synthesis.SynthesizerState]::Ready) {
        if ($inputTask.Wait(50)) {
            $line = $inputTask.Result
            if ($null -eq $line) { $synth.SpeakAsyncCancelAll(); break }
            $command = $line | ConvertFrom-Json
            switch ($command.command) {
                'pause' { $synth.Pause() }
                'resume' { $synth.Resume() }
                'stop' { $synth.SpeakAsyncCancelAll(); break }
            }
            $inputTask = [Console]::In.ReadLineAsync()
        }
    }
} finally { $synth.Dispose() }

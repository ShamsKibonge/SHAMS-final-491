$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $repoRoot "generated"
$outFile = Join-Path $outDir "PISCES_Supporting_Documents_Papy_Shamirani.docx"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("pisces-docx-" + [System.Guid]::NewGuid().ToString("N"))

function Escape-XmlText {
    param([string]$Text)
    return [System.Security.SecurityElement]::Escape($Text)
}

function Add-Paragraph {
    param(
        [System.Text.StringBuilder]$Builder,
        [string]$Text,
        [string]$Style = "Normal"
    )

    $escaped = Escape-XmlText $Text
    $styleXml = ""
    if ($Style -ne "Normal") {
        $styleXml = "<w:pPr><w:pStyle w:val=`"$Style`"/></w:pPr>"
    }

    [void]$Builder.AppendLine("<w:p>$styleXml<w:r><w:t xml:space=`"preserve`">$escaped</w:t></w:r></w:p>")
}

function Add-Blank {
    param([System.Text.StringBuilder]$Builder)
    [void]$Builder.AppendLine("<w:p/>")
}

function Write-Utf8File {
    param(
        [string]$Path,
        [string]$Value
    )

    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Value, $utf8NoBom)
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $tempRoot "_rels") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $tempRoot "docProps") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $tempRoot "word") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $tempRoot "word\_rels") | Out-Null

$body = [System.Text.StringBuilder]::new()
Add-Paragraph $body "PISCES Certificate Supporting Documents" "Title"
Add-Paragraph $body "Prepared for: Beau Jones"
Add-Paragraph $body "Student/Analyst: Papy Shamirani"
Add-Paragraph $body "Purpose: Evidence of significant participation in PISCES through ticket investigations, visualization/system work, threat hunting, and related SOC activities."
Add-Blank $body

Add-Paragraph $body "Recommended Ticket Evidence" "Heading1"
Add-Paragraph $body "I would reference tickets 13508 and 13120 as the strongest evidence because both show credible analyst investigation, useful supporting details, and follow-through that resulted in client notification or concrete remediation guidance."
Add-Blank $body

Add-Paragraph $body "Ticket 13508 - Web Exploitation Attempt, Apache HTTP Server path traversal, CVE-2021-42013/CVE-2021-41773" "Heading2"
Add-Paragraph $body "Ticket URL: https://wa-mantis.cyberrangepoulsbo.com/view.php?id=13508"
Add-Paragraph $body "Project: bonney-lake"
Add-Paragraph $body "Status: resolved"
Add-Paragraph $body "Created: 2026-03-24 23:17:11 Pacific"
Add-Paragraph $body "Updated: 2026-04-06 11:57:25 Pacific"
Add-Paragraph $body "Source IP: 37.120.213.13"
Add-Paragraph $body "Destination IP/Host: 10.62.0.12 / bonney-lake2"
Add-Paragraph $body "Destination Port: 80"
Add-Paragraph $body "Signature: ET EXPLOIT Apache HTTP Server - Path Traversal Attempt (CVE-2021-42013) M2"
Add-Paragraph $body "Target URL: /cgi-bin/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/bin/sh"
Add-Paragraph $body "Why this is strong evidence: This ticket identified inbound requests containing encoded directory traversal sequences targeting /cgi-bin/ and attempting to access /bin/sh. The behavior matched known exploitation techniques for Apache HTTP Server vulnerabilities CVE-2021-42013 and CVE-2021-41773."
Add-Paragraph $body "Resolution and impact: The reviewer notified the client and documented recommended actions: ensure the affected system is patched, review web server logs for successful responses such as HTTP 200 or unexpected command execution, and block source IP 37.120.213.13 if there is no legitimate business need. The review found no indicators of successful exploitation or command execution, and classified the activity as limited automated vulnerability scanning."
Add-Blank $body

Add-Paragraph $body "Ticket 13120 - External host probing internal web server for phpinfo exposure" "Heading2"
Add-Paragraph $body "Ticket URL: https://wa-mantis.cyberrangepoulsbo.com/view.php?id=13120"
Add-Paragraph $body "Project: bainbridge"
Add-Paragraph $body "Status: resolved"
Add-Paragraph $body "Created: 2026-03-03 14:05:07 Pacific"
Add-Paragraph $body "Updated: 2026-03-24 22:31:35 Pacific"
Add-Paragraph $body "Source IP: 104.219.238.86"
Add-Paragraph $body "Destination IP: 10.62.0.12"
Add-Paragraph $body "Destination Port: 80"
Add-Paragraph $body "Signature/Summary: External host probing internal web server for phpinfo exposure"
Add-Paragraph $body "Why this is strong evidence: This ticket investigated automated web probing for exposed application files and information pages such as phpinfo. The analysis considered the source IP, target web server, HTTP activity, response behavior, and reputation/context information contributed by another analyst."
Add-Paragraph $body "Resolution and impact: The reviewer notified the client that the external IP attempted to access multiple web application paths, including configuration files and information pages. The observed responses were HTTP 404 Not Found, indicating no data exposure and no evidence of successful access. Recommendations included keeping systems and web applications updated, restricting external access to administrative interfaces, avoiding public exposure of sensitive files, and blocking 104.219.238.86."
Add-Blank $body

Add-Paragraph $body "Additional Ticket Evidence" "Heading1"
Add-Paragraph $body "Ticket 14287 - Exploit Attempts Attempt, ET WEB_SERVER Possible CVE-2014-6271 Attempt in HTTP Cookie. This ticket was reviewed as an excellent and detailed analysis. The traffic originated from internal OpenVAS vulnerability scanning from 10.2.1.30 to 10.250.0.53 on port 8080 and was resolved as expected internal vulnerability assessment activity."
Add-Paragraph $body "Ticket 14162 - Web Exploitation Attempt, ET WEB_SERVER ColdFusion administrator access. The reviewer noted that the traffic was a real vulnerability test and that the analyst instinct was correct in investigating possible threat actor or pentester activity. It was later attributed to an authorized MSP provider."
Add-Paragraph $body "Ticket 13626 - Exploit Attempts Attempt, Apache Log4j RCE CVE-2021-44228. This ticket shows collaboration because an analyst asked for an updated evidence link, and I followed up with a corrected OpenSearch query and time range. The review confirmed that the finding represented a real Log4j RCE-style detection, later attributed to authorized Rapid7 vulnerability scanning."
Add-Paragraph $body "Ticket 14161 - Brute Force Attempt, SSH::Password_Guessing. The investigation identified SSH password-guessing activity from 54.70.216.55 to 152.157.6.88 on port 22. The reviewer confirmed the brute-force action was blocked by the firewall."
Add-Blank $body

Add-Paragraph $body "Visualization and System Evidence" "Heading1"
Add-Paragraph $body "Visualization/System name: S.H.A.M.S - SOC Hunting And Mitigation System, including Dashboard v1, Case Manager v1, and Ticket Registry."
Add-Paragraph $body "S.H.A.M.S is the system we built and used to support PISCES-style SOC triage. It started from a Kibana/ELK-style workflow where analysts manually searched alerts, filtered noise, pivoted across IPs and signatures, and wrote tickets by hand. The final working version uses OpenSearch as the telemetry backend and connects the investigation workflow to MantisBT ticketing."
Add-Paragraph $body "The Dashboard v1 view presents grouped OpenSearch case candidates by SOC category. Analysts can inspect evidence, run AI analysis, execute pivots, check for duplicate Mantis tickets, and create evidence-backed tickets from one workflow."
Add-Paragraph $body "The Case Manager v1 view runs an automated last-hour OpenSearch grouping process, ranks cases locally, investigates the highest-value cases with AI support, executes limited pivots, and displays live investigation status."
Add-Paragraph $body "The Ticket Registry stores created, synced, and manually added Mantis tickets with network indicators, ticket status, OpenSearch context, analyst decisions, notes, and reuse history. This was useful for choosing certificate evidence because it preserved ticket IDs, summaries, IPs, signatures, status, notes, and reviewer feedback."
Add-Blank $body

Add-Paragraph $body "Threat Hunting Exercise" "Heading1"
Add-Paragraph $body "I performed web exploitation hunting by pivoting from IDS/OpenSearch alerts into source IP, destination IP, destination port, HTTP URI/path, response behavior, signatures, CVEs, and prior ticket history. The goal was to distinguish opportunistic scanning, authorized vulnerability testing, blocked activity, false positives, and potentially successful exploitation."
Add-Paragraph $body "For the web exploitation tickets, I reviewed indicators such as encoded path traversal strings, attempts to access /bin/sh, phpinfo exposure probing, configuration-file probing, destination web services, and HTTP response evidence such as 404 Not Found. I also considered whether the traffic volume, direction, source identity, and observed bytes supported escalation."
Add-Paragraph $body "The result of this hunt was multiple evidence-backed tickets, including cases where reviewers confirmed the activity was worth reporting to the client, cases where traffic was determined to be blocked, and cases where alerts were attributed to authorized vulnerability scanning."
Add-Blank $body

Add-Paragraph $body "Other Significant PISCES Activities" "Heading1"
Add-Paragraph $body "Created and followed up on Mantis tickets for web exploitation, brute force, exploit attempts, lateral movement, reconnaissance, malware-style detections, and suspicious network activity."
Add-Paragraph $body "Used OpenSearch/Kibana-style filters to validate security alerts and provide reproducible evidence links or manual queries."
Add-Paragraph $body "Contributed investigation notes and follow-up context when other analysts needed better time ranges, filters, or OpenSearch links."
Add-Paragraph $body "Helped classify events as malicious attempts, blocked activity, authorized vulnerability scanner traffic, expected monitoring, benign false positives, or low-risk background scanning."
Add-Paragraph $body "Built and used S.H.A.M.S to reduce repetitive triage work, group related security telemetry into cases, run AI-assisted analysis, execute pivots, preserve ticket history, and connect final analyst decisions to MantisBT."
Add-Blank $body

Add-Paragraph $body "Suggested Narrative Answer" "Heading1"
Add-Paragraph $body "For ticket evidence, I would like to reference tickets 13508 and 13120. Ticket 13508 involved a Web Exploitation Attempt for Apache HTTP Server path traversal associated with CVE-2021-42013/CVE-2021-41773. I identified inbound requests from external IP 37.120.213.13 targeting 10.62.0.12 over port 80, including encoded directory traversal attempts against /cgi-bin/ and /bin/sh. The ticket was reviewed and escalated to client notification with recommendations to patch, review web server logs, and block the source IP if not needed."
Add-Paragraph $body "Ticket 13120 involved an external host probing an internal web server for phpinfo and other exposed web resources. I investigated activity from 104.219.238.86 to 10.62.0.12 over HTTP and documented behavior consistent with automated web scanning. The investigation included review of response behavior showing HTTP 404 responses and no evidence of successful access. The ticket was later reported to the client with recommendations to restrict exposed resources, keep systems updated, restrict administrative interfaces, and block the source IP."
Add-Paragraph $body "For visualization and system evidence, I used S.H.A.M.S, the SOC Hunting And Mitigation System we built for the Bellevue College SEC490/491 capstone. S.H.A.M.S provides Dashboard v1, Case Manager v1, and Ticket Registry views over OpenSearch telemetry. It groups SOC alerts into cases, supports AI-assisted analysis, executes pivots, preserves ticket history, and connects evidence-backed decisions to MantisBT tickets."
Add-Paragraph $body "As a threat hunting exercise, I performed web exploitation hunting by pivoting from IDS/OpenSearch alerts into source IPs, destination IPs, destination ports, HTTP paths, signatures, CVEs, response behavior, and prior ticket history. This helped determine whether events represented successful exploitation, opportunistic scanning, authorized vulnerability testing, blocked traffic, or benign false positives."

$documentXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
$($body.ToString())
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
"@

$stylesXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
</w:styles>
"@

$contentTypesXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"@

$relsXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"@

$docRelsXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"@

$created = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$coreXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>PISCES Certificate Supporting Documents</dc:title>
  <dc:creator>Papy Shamirani</dc:creator>
  <cp:lastModifiedBy>S.H.A.M.S</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">$created</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">$created</dcterms:modified>
</cp:coreProperties>
"@

$appXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>S.H.A.M.S</Application>
</Properties>
"@

Write-Utf8File -Path (Join-Path $tempRoot "[Content_Types].xml") -Value $contentTypesXml
Write-Utf8File -Path (Join-Path $tempRoot "_rels\.rels") -Value $relsXml
Write-Utf8File -Path (Join-Path $tempRoot "word\document.xml") -Value $documentXml
Write-Utf8File -Path (Join-Path $tempRoot "word\styles.xml") -Value $stylesXml
Write-Utf8File -Path (Join-Path $tempRoot "word\_rels\document.xml.rels") -Value $docRelsXml
Write-Utf8File -Path (Join-Path $tempRoot "docProps\core.xml") -Value $coreXml
Write-Utf8File -Path (Join-Path $tempRoot "docProps\app.xml") -Value $appXml

if (Test-Path $outFile) {
    Remove-Item -LiteralPath $outFile -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($tempRoot, $outFile)
Remove-Item -LiteralPath $tempRoot -Recurse -Force

Write-Output $outFile

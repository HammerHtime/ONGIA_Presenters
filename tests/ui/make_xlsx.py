import xlsxwriter, struct, zlib, sys
out = sys.argv[1]
wb = xlsxwriter.Workbook(out)
# a tab like the real one: a picture on top, an empty row, then headings
ws = wb.add_worksheet("2026 CONFERENCE TORONTO")
png = lambda: (b'\x89PNG\r\n\x1a\n' + (lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff))(b'IHDR', struct.pack('>IIBBBBB', 40, 40, 8, 2, 0, 0, 0)) + (lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff))(b'IDAT', zlib.compress(b''.join(b'\x00' + b'\x1f\x7a\x72' * 40 for _ in range(40)))) + (lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff))(b'IEND', b''))
open('/tmp/pic.png', 'wb').write(png())
ws.insert_image('A1', '/tmp/pic.png')
head = ["Presenter", "Agency", "Title/Topic", "Confirmed", "Conference Fee waived", "Accommodations  Sunday", "Accommodations Monday", "Accommodations Tuesday", "Accommodations Wednesday", "Accommodations Thursday", "Travel Expenses", "Notes / Comments "]
for c, h in enumerate(head): ws.write(2, c, h)
Y, N, NA = "Yes", "No", "NA"
AG = "Yes (Agency paying we are just booking)"
rows = [
  ["Dana Keynote (Keynote)", "Conflictish", "Tact", "Yes", "Yes", Y, Y, Y, Y, Y, "Yes", ""],
  ["A/S/Sgt Dana Testwood ", "Test Police Service", "Models", "Yes", "Yes", AG, AG, AG, N, N, "No", "TPS covering all costs"],
  ["Kelly Samplestone", "Test Police Service", "Models", "Yes", "Yes", AG, AG, AG, AG, N, "No", ""],
  ["Dr. Robin Fakewell ", "Test University", "Safety", "Yes", "Yes", Y, Y, Y, Y, N, "Yes", "no speaker fee"],
  ["Casey Mockton", "Str8 Test", "Safety", "Yes", "Yes", "", "", "", "", N, "Yes", ""],
  ["Avery Placeholder", "Test Police Service", "Ghosts", "Yes", "Yes", Y, Y, Y, Y, N, "Yes", ""],
  ["Detective Exampleton", "Winnipeg Test Service", "Aftermath", "Yes", "Yes", Y, Y, Y, Y, N, "No", ""],
  ["Local Person", "Toronto Test", "Poppy", "Yes", "Yes", NA, NA, NA, NA, NA, "NA", "Local"],
  ["Sheetonly Presenter", "Nowhere", "Ghost row", "Yes", "Yes", Y, Y, N, N, N, "No", ""],
  ["Morgan Demoford", "Montreal Test", "Aurora", "Yes", "Yes", N, N, Y, Y, Y, "No", ""],
]
for r, row in enumerate(rows):
    for c, v in enumerate(row): ws.write(3 + r, c, v)
# a sensitive tab that must never be sent
ws2 = wb.add_worksheet("MASTER PRESENTER LIST")
ws2.write_row(0, 0, ["Presenter", "Agency", "Notes"])
ws2.write_row(1, 0, ["Should Never Leave", "Secret Unit", "operationally sensitive notes"])
wb.close()

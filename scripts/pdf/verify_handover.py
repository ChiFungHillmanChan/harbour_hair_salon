#!/usr/bin/env python3
"""Verify the blank master and round-trip a separate Chinese/English QA copy.

No recipient, account or secret is used. All QA artifacts stay in tmp/pdfs/.
"""
import json
import hashlib
import sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf._font import Font
from unicode_forms import update_unicode_form_values

ROOT=Path(__file__).resolve().parents[2]
MASTER=ROOT/'output/pdf/harbour-hair-salon-handover-fillable.pdf'
MANIFEST=ROOT/'tmp/pdfs/field-manifest.json'
QA_FIRST=ROOT/'tmp/pdfs/handover-qa-filled.pdf'
QA_FINAL=ROOT/'tmp/pdfs/handover-qa-reopened.pdf'


def inspect(path, expected, blank=False):
    reader=PdfReader(path)
    canonical=reader.get_fields() or {}
    assert len(reader.pages)==16
    assert set(canonical)==set(expected), 'Canonical fields differ from manifest'
    top_fields=reader.trailer['/Root']['/AcroForm']['/Fields']
    assert len(top_fields)==len(expected), 'Unexpected duplicate or child fields'
    top_refs={reference.idnum for reference in top_fields}
    widget_names=[]
    inventory=[]
    reverse_cache={}
    for page_number,page in enumerate(reader.pages,1):
        for reference in page.get('/Annots',[]):
            widget=reference.get_object()
            if widget.get('/Subtype')!='/Widget':
                continue
            name=str(widget.get_inherited('/T'))
            widget_names.append(name)
            assert reference.idnum in top_refs or widget.get('/Parent') is not None, 'Orphan or ambiguous widget'
            target=expected[name]
            value=widget.get_inherited('/V')
            assert str(canonical[name].get('/V',''))==str(target), f'Canonical /V {name}'
            assert str(value or '')==str(target), f'Widget /V {name}'
            ap=widget['/AP']['/N'].get_object()
            kind=widget.get_inherited('/FT')
            if kind=='/Btn':
                assert str(widget.get('/AS'))==str(target), f'Checkbox /AS {name}'
                assert ap[str(target)].get_object().get_data(), f'Checkbox appearance {name}'
            else:
                assert ap.get_data(), f'Missing /AP {name}'
                assert '/CJK' in str(widget.get_inherited('/DA')), f'Wrong form font {name}'
                assert int(widget.get_inherited('/Ff') or 0)&4096, f'Expected multiline {name}'
                if target:
                    resource=ap['/Resources']['/Font']['/CJK'].get_object()
                    ref=resource.indirect_reference.idnum
                    if ref not in reverse_cache:
                        font=Font.from_font_resource(resource)
                        reverse_cache[ref]={value:key.encode(font.encoding) for key,value in font.character_map.items() if isinstance(key,str)}
                    reverse=reverse_cache[ref]
                    # pypdf emits separate text runs for wrapped lines. Check every
                    # requested printable glyph appears in a valid encoded run.
                    appearance=ap.get_data().lower()
                    for char in str(target):
                        if char in '\n\r':
                            continue
                        assert char in reverse, f'Unsupported character {char!r}'
                        assert reverse[char].hex().encode() in appearance, f'Stale AP for {name}: {char!r}'
            inventory.append({'name':name,'page':page_number,'type':str(kind),'value':str(value or ''),'appearance':True})
    assert len(widget_names)==len(set(widget_names))==len(expected), 'Duplicate or missing widget names'
    acroform=reader.trailer['/Root']['/AcroForm']
    assert not getattr(acroform.get('/NeedAppearances',False), 'value', False), 'Must not rely on NeedAppearances'
    font=acroform['/DR']['/Font']['/CJK'].get_object()
    assert font['/Subtype']=='/Type0' and font['/Encoding']=='/Identity-H'
    assert font['/ToUnicode'].get_object().get_data()
    descendant=font['/DescendantFonts'][0].get_object()
    assert descendant['/FontDescriptor']['/FontFile2'].get_object().get_data()
    assert descendant['/CIDToGIDMap'].get_object().get_data()
    return inventory


def main():
    master_sha256=hashlib.sha256(MASTER.read_bytes()).hexdigest()
    manifest=json.loads(MANIFEST.read_text())
    blank={item['name']:('/Off' if item['type']=='checkbox' else '') for item in manifest['fields']}
    inspect(MASTER,blank,blank=True)
    values={item['name']:('/Yes' if item['type']=='checkbox' else '陳 Chan') for item in manifest['fields']}
    values.update({
      'visit_owner':'陳美玲 Chan Mei Ling',
      'visit_datetime':'2026-09-18 10:30',
      'owner_admin_email':'bookings@example.com',
      'staff_1_hours_1':'09:00-18:00\n13:00-14:00 休息',
      'service_1_0':'洗剪吹\nHAIR-01 / TW-101',
      'service_1_1':'60 分鐘\nbuffer 15',
      'inbound_1_tw_setup':'員工 01 / TW-001\nvault：日曆項目 A',
      'inbound_1_tw_tests':'新增／改期／取消通過\n10:00 → 10:15；15 分鐘',
      'signoff_notes':'此為虛構 QA 測試副本，唔係正式簽收。\n香港九龍尖沙咀 / Leeds\n繁體中文與 English 均可儲存。',
    })
    writer=PdfWriter(clone_from=MASTER)
    update_unicode_form_values(writer,values)
    writer.write(QA_FIRST)
    inspect(QA_FIRST,values)
    # Read the saved file, edit CJK to different glyphs and clear checkboxes,
    # then save and reopen again. The master itself is never filled.
    values['visit_owner']='鍾偉強 Chung Wai Keung'
    values['signoff_owner']='鍾偉強（測試）'
    values['decision_enable_booking']='/Off'
    values['decision_external_only']='/Off'
    values['decision_internal_test']='/Off'
    values['decision_defer']='/Yes'
    values['acceptance_1_passed']='/Off'
    writer=PdfWriter(clone_from=QA_FIRST)
    update_unicode_form_values(writer,values)
    writer.write(QA_FINAL)
    inventory=inspect(QA_FINAL,values)
    inspect(MASTER,blank,blank=True)
    assert hashlib.sha256(MASTER.read_bytes()).hexdigest()==master_sha256, 'Master changed during QA'
    report={'status':'PASS','master_sha256':master_sha256,'pages':16,'canonical_fields':len(blank),'widgets':len(inventory),
      'text_fields':manifest['text_count'],'checkboxes':manifest['checkbox_count'],
      'unique_names':True,'blank_master_preserved':True,'unicode_english_multiline_roundtrip':True,
      'checkbox_on_off_roundtrip':True,'canonical_widget_values_match':True,
      'appearances_generated':True,'full_cjk_font_embedded':True,'need_appearances':False,
      'master_bytes':MASTER.stat().st_size,'qa_copy':str(QA_FINAL),'field_inventory':inventory}
    (ROOT/'tmp/pdfs/verification-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({key:value for key,value in report.items() if key!='field_inventory'},ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()

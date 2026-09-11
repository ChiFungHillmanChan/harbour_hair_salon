"""Embedded editable CJK AcroForms for pypdf; no NeedAppearances dependency.

The entire selected TrueType font face is embedded, not a sample-text subset.
Future field values may use any character in that face's Unicode cmap.
"""
from io import BytesIO
from pathlib import Path
import os
import re
import sys

try:
    from fontTools.ttLib import TTFont
except ModuleNotFoundError:
    # This machine has fontTools in its system-Python user site, while the PDF
    # packages are in Codex's bundled Python. fontTools' TTF path is pure Python.
    for site in sorted((Path.home() / "Library/Python").glob("*/lib/python/site-packages")):
        if (site / "fontTools").is_dir():
            sys.path.append(str(site))
    from fontTools.ttLib import TTFont

from pypdf.generic import (
    ArrayObject, BooleanObject, DecodedStreamObject, DictionaryObject,
    FloatObject, NameObject, NumberObject, TextStringObject,
)

DEFAULT_FONT = "/System/Library/Fonts/STHeiti Light.ttc"


def update_unicode_form_values(writer, values, *, flatten=False):
    """Generate genuine appearances, working around pypdf 6.10's CMap sentinel.

    pypdf's parser retains character_map[-1] as byte-width metadata, but its
    appearance generator expects string keys. Remove that non-character entry
    only while running the normal pypdf form updater; restore the method after.
    The resulting PDF itself needs no patch, JavaScript, or NeedAppearances.
    """
    from pypdf._font import Font
    from unittest.mock import patch
    original = Font.from_font_resource.__func__

    @classmethod
    def font_without_parser_metadata(cls, *args, **kwargs):
        font = original(cls, *args, **kwargs)
        font.character_map.pop(-1, None)
        return font

    with patch.object(Font, "from_font_resource", font_without_parser_metadata):
        writer.update_page_form_field_values(None, values, auto_regenerate=False, flatten=flatten)


def install_unicode_form_font(writer, font_path=None, font_number=0,
                              resource_name="/CJK", font_size=None):
    """Install full Unicode Type0 font in /AcroForm /DR and text fields' /DA.

    Call after cloning/adding the ReportLab form to the writer, before calling
    writer.update_page_form_field_values(..., auto_regenerate=False).
    Returns a codepoint->CID mapping for optional diagnostics.
    """
    font_path = font_path or os.environ.get("SALON_PDF_FORM_FONT") or DEFAULT_FONT
    font = TTFont(font_path, fontNumber=font_number)
    if "glyf" not in font:
        raise ValueError("Use a TrueType glyf font (CIDFontType2), not CFF outlines")
    restrictions = font["OS/2"].fsType
    if restrictions & 2 or (restrictions & 4 and not restrictions & 8):
        raise ValueError("The selected font does not permit editable embedding")
    cmap = font.getBestCmap()
    if len(cmap) >= 0xD800:
        raise ValueError("This helper keeps two-byte CIDs below UTF-16 surrogate range")
    code_to_cid = {code: index for index, code in enumerate(sorted(cmap), 1)}
    gid_by_name = {name: index for index, name in enumerate(font.getGlyphOrder())}
    scale = 1000 / font["head"].unitsPerEm
    cid_to_gid = bytearray(2 * (len(code_to_cid) + 1))
    widths = []
    mappings = []
    for code, cid in code_to_cid.items():
        glyph_name = cmap[code]
        cid_to_gid[2 * cid:2 * cid + 2] = gid_by_name[glyph_name].to_bytes(2, "big")
        widths.append(NumberObject(round(font["hmtx"].metrics[glyph_name][0] * scale)))
        unicode_hex = chr(code).encode("utf-16-be").hex().upper()
        mappings.append(f"<{cid:04X}> <{unicode_hex}>")
    name = font["name"].getDebugName(6) or "EditableUnicode"
    font_buffer = BytesIO()
    font.save(font_buffer)

    def stream(data, **attributes):
        value = DecodedStreamObject()
        value.set_data(data)
        for key, item in attributes.items():
            value[NameObject("/" + key)] = item
        return writer._add_object(value.flate_encode())

    file_reference = stream(font_buffer.getvalue(), Length1=NumberObject(len(font_buffer.getvalue())))
    head = font["head"]
    descriptor = DictionaryObject({
        NameObject("/Type"): NameObject("/FontDescriptor"),
        NameObject("/FontName"): NameObject("/" + name),
        NameObject("/Flags"): NumberObject(4),
        NameObject("/FontBBox"): ArrayObject(FloatObject(value * scale) for value in [head.xMin, head.yMin, head.xMax, head.yMax]),
        NameObject("/ItalicAngle"): FloatObject(font["post"].italicAngle),
        NameObject("/Ascent"): FloatObject(font["hhea"].ascent * scale),
        NameObject("/Descent"): FloatObject(font["hhea"].descent * scale),
        NameObject("/CapHeight"): FloatObject(getattr(font["OS/2"], "sCapHeight", font["hhea"].ascent) * scale),
        NameObject("/StemV"): NumberObject(80),
        NameObject("/FontFile2"): file_reference,
    })
    descendant = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/CIDFontType2"),
        NameObject("/BaseFont"): NameObject("/" + name),
        NameObject("/CIDSystemInfo"): DictionaryObject({
            NameObject("/Registry"): TextStringObject("Adobe"),
            NameObject("/Ordering"): TextStringObject("Identity"),
            NameObject("/Supplement"): NumberObject(0),
        }),
        NameObject("/FontDescriptor"): writer._add_object(descriptor),
        NameObject("/CIDToGIDMap"): stream(bytes(cid_to_gid)),
        NameObject("/DW"): NumberObject(1000),
        NameObject("/W"): ArrayObject([NumberObject(1), ArrayObject(widths)]),
    })
    cmap_lines = [
        "/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        "/CMapName /EditableUnicode-UCS def", "/CMapType 2 def",
        "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange",
    ]
    for offset in range(0, len(mappings), 100):
        group = mappings[offset:offset + 100]
        cmap_lines += [f"{len(group)} beginbfchar", *group, "endbfchar"]
    cmap_lines += ["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"]
    type_zero = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type0"),
        NameObject("/BaseFont"): NameObject("/" + name),
        NameObject("/Encoding"): NameObject("/Identity-H"),
        NameObject("/DescendantFonts"): ArrayObject([writer._add_object(descendant)]),
        NameObject("/ToUnicode"): stream("\n".join(cmap_lines).encode("ascii")),
    })
    font_reference = writer._add_object(type_zero)
    acroform = writer.root_object["/AcroForm"].get_object()
    if "/DR" not in acroform:
        acroform[NameObject("/DR")] = DictionaryObject()
    resources = acroform["/DR"].get_object()
    if "/Font" not in resources:
        resources[NameObject("/Font")] = DictionaryObject()
    resources["/Font"].get_object()[NameObject(resource_name)] = font_reference
    def appearance_for(existing):
        size = font_size
        if size is None:
            match = re.search(r"/\S+\s+([-+]?(?:\d*\.)?\d+)\s+Tf", str(existing or ""))
            size = float(match.group(1)) if match else 10
        return TextStringObject(f"{resource_name} {size:g} Tf 0 g")

    acroform[NameObject("/DA")] = appearance_for(acroform.get("/DA"))
    acroform[NameObject("/NeedAppearances")] = BooleanObject(False)

    def set_field_font(reference, inherited_type=None):
        field = reference.get_object()
        field_type = field.get("/FT", inherited_type)
        if field_type in ("/Tx", "/Ch"):
            field[NameObject("/DA")] = appearance_for(field.get_inherited("/DA", acroform["/DA"]))
        for child in field.get("/Kids", []):
            set_field_font(child, field_type)

    for field in acroform["/Fields"]:
        set_field_font(field)
    for page in writer.pages:
        for reference in page.get("/Annots", []):
            annotation = reference.get_object()
            if annotation.get("/Subtype") == "/Widget" and annotation.get_inherited("/FT") in ("/Tx", "/Ch"):
                annotation[NameObject("/DA")] = appearance_for(annotation.get_inherited("/DA", acroform["/DA"]))
    font.close()
    return code_to_cid



def unicode_font_metadata(font_path=None, font_number=0):
    """Describe the embedded face's coverage and editable-embedding flags."""
    font_path = font_path or os.environ.get("SALON_PDF_FORM_FONT") or DEFAULT_FONT
    font = TTFont(font_path, fontNumber=font_number, lazy=True)
    try:
        cmap = font.getBestCmap()
        supplementary = sum(code > 0xFFFF for code in cmap)
        return {
            "font_path": str(font_path),
            "font_face_index": font_number,
            "postscript_name": font["name"].getDebugName(6),
            "unicode_characters": len(cmap),
            "bmp_characters": len(cmap) - supplementary,
            "supplementary_characters": supplementary,
            "glyph_count": len(font.getGlyphOrder()),
            "embedding_flags": font["OS/2"].fsType,
            "embedded_coverage": "All Unicode characters in the selected face; not a sample-text subset",
            "pdf_encoding": "Type0 Identity-H with complete ToUnicode and CIDToGIDMap",
        }
    finally:
        font.close()


def embed_form_font(input_path, output_path, font_path=None, *,
                    font_number=0, font_size=None):
    """Postprocess ReportLab AcroForms and write their initial real appearances.

    Field names, logical values, flags, and widgets stay interactive. Text and
    choice fields receive the embedded font; button/checkbox fonts are retained.
    Existing per-field font sizes are retained unless font_size is supplied.
    SALON_PDF_FORM_FONT may override the default STHeiti face at runtime.
    Fill later via update_unicode_form_values(writer, values), which updates
    canonical /V values and widget /AP streams without NeedAppearances.
    """
    from pypdf import PdfWriter

    writer = PdfWriter(clone_from=str(input_path))
    install_unicode_form_font(
        writer, font_path=font_path, font_number=font_number, font_size=font_size,
    )
    fields = writer.get_fields() or {}
    initial_values = {
        name: field.get("/V", "")
        for name, field in fields.items()
        if field.get("/FT") in ("/Tx", "/Ch")
    }
    if initial_values:
        update_unicode_form_values(writer, initial_values)
    writer.write(str(output_path))
    return unicode_font_metadata(font_path, font_number)

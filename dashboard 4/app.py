import os
import re
import streamlit as st
import streamlit.components.v1 as components

st.set_page_config(
    page_title="STIR Pro Dashboard",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# Strip every piece of Streamlit chrome and collapse all padding to zero.
# We deliberately do NOT use position:fixed or height=1 - those are fragile.
# Instead we use a generous fixed height and let the dashboard scroll internally.
st.markdown("""
<style>
#MainMenu, header, footer,
[data-testid="stToolbar"],
[data-testid="stDecoration"],
[data-testid="stStatusWidget"],
[data-testid="stSidebarCollapsedControl"],
[data-testid="stBottom"] {
    display: none !important;
}
html, body, .stApp {
    background: #0a0c14 !important;
    overflow: hidden !important;
}
[data-testid="stAppViewContainer"],
[data-testid="stMain"],
[data-testid="stMainBlockContainer"],
[data-testid="stVerticalBlock"],
[data-testid="element-container"],
.block-container {
    padding: 0 !important;
    margin: 0 !important;
    max-width: 100% !important;
    background: #0a0c14 !important;
}
[data-testid="stComponentFrame"],
[data-testid="stComponentFrame"] > iframe {
    display: block !important;
    width: 100vw !important;
    height: calc(100vh - 2px) !important;
    min-height: 600px !important;
    border: none !important;
    background: #0a0c14 !important;
}
</style>
""", unsafe_allow_html=True)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def read_file(name):
    with open(os.path.join(BASE_DIR, name), "r", encoding="utf-8") as f:
        return f.read()


def safe_inline(pattern, replacement, text):
    return re.sub(pattern, lambda _: replacement, text)


@st.cache_resource(show_spinner="Loading dashboard...")
def build_html():
    css     = read_file("style.css")
    data_js = read_file("data.js")
    app_js  = read_file("app.js")
    html    = read_file("index.html")

    html = safe_inline(
        r'<link[^>]*href=["\']style\.css["\'][^>]*?>',
        "<style>\n" + css + "\n</style>", html
    )

    chart_path = os.path.join(BASE_DIR, "chart_umd_min.js")
    if os.path.exists(chart_path):
        with open(chart_path, "r", encoding="utf-8") as f:
            chart_tag = "<script>\n" + f.read() + "\n</script>"
    else:
        chart_tag = (
            '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4'
            '/dist/chart.umd.min.js"></script>'
        )

    html = safe_inline(r'<script\s+src=["\']chart_umd_min\.js["\']></script>', chart_tag, html)
    html = safe_inline(r'<script\s+src=["\']data\.js["\']></script>',
                       "<script>\n" + data_js + "\n</script>", html)
    html = safe_inline(r'<script\s+src=["\']app\.js["\']></script>',
                       "<script>\n" + app_js + "\n</script>", html)
    return html


dashboard_html = build_html()

# scrolling=True lets the dashboard scroll internally.
# height matches 100vh: Streamlit adds ~2px of margin so we compensate.
# The CSS above also enforces 100vh on the iframe wrapper for browsers
# where the CSS injection takes effect before the component renders.
components.html(dashboard_html, height=800, scrolling=True)

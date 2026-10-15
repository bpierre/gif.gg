use crate::config::Config;

// Match JavaScript encodeURIComponent, including its unescaped punctuation.
fn encode_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write;
            write!(&mut encoded, "%{byte:02X}").unwrap();
        }
    }
    encoded
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn layout(config: &Config, head: &str, content: &str, scripts: &str) -> String {
    let stylesheet = if config.debug {
        "/css/index.css".into()
    } else {
        format!("/css/gif.gg.css?{}", encode_component(&config.version))
    };
    include_str!("../templates/layout.html")
        .replace("{{head}}", head)
        .replace("{{stylesheet}}", &stylesheet)
        .replace(
            "{{development}}",
            if config.debug {
                " data-development=\"true\""
            } else {
                ""
            },
        )
        .replace("{{content}}", content)
        .replace("{{scripts}}", scripts)
}

pub fn main_page(config: &Config) -> String {
    layout(
        config,
        "",
        "",
        &format!(
            "<script type=\"module\" src=\"/js/gif.gg.js?{}\"></script>",
            encode_component(&config.version)
        ),
    )
}

pub fn about(config: &Config) -> String {
    layout(config, "", include_str!("../templates/about.html"), "")
}

fn gif_template(template: &str, id: &str) -> String {
    let escaped = escape(id);
    template
        .replace("{{id}}", &escaped)
        .replace("{{gif_url}}", &format!("/{escaped}.gif"))
}

pub fn gif(config: &Config, id: &str) -> String {
    layout(
        config,
        &gif_template(include_str!("../templates/gif-head.html"), id),
        &gif_template(include_str!("../templates/gif-content.html"), id),
        "",
    )
}

pub fn player(id: &str) -> String {
    gif_template(include_str!("../templates/player.html"), id)
}

pub fn error(config: &Config, status: u16) -> String {
    let message = if status == 404 {
        "Sorry, the page you are looking for is not available."
    } else {
        "Sorry, but something went terribly wrong."
    };
    layout(
        config,
        "",
        &format!("<p>{message}</p>\n<p><a href=\"/\">Make a new gif</a></p>"),
        "",
    )
}

# Required dependencies:
# npm install uglify-js -g
# npm install clean-css -g
# npm install browserify -g

# Binaries
BROWSERIFY_BIN = browserify
UGLIFY_BIN = uglifyjs
CLEANCSS_BIN = cleancss

PROJECT_NAME = gif.gg

# JS files
JS_FINAL = public/js/${PROJECT_NAME}.js
JS_TARGET = public/js/index.js

# CSS files
CSS_FINAL = public/css/${PROJECT_NAME}.css
CSS_TARGET = public/css/index.css

all: $(JS_FINAL) $(CSS_FINAL)

# JS
$(JS_FINAL): $(JS_TARGET)
	$(BROWSERIFY_BIN) $^ -o $@-uncompressed
	$(UGLIFY_BIN) $@-uncompressed > $@
	rm $@-uncompressed

# CSS
$(CSS_FINAL): $(CSS_TARGET)
	$(CLEANCSS_BIN) $< >$@

clean:
	rm -f $(JS_FINAL) $(CSS_FINAL)

.DEFAULT_GOAL := all

.PHONY: clean

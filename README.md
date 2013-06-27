# gif.gg

## Requirements

- PHP 5.4+
- MySQL 5.x+

## Installation

Create a database for gif.gg and import the schema:

```
$ mysql -u USER -p DATABASE < schema.sql
```

Copy and edit the config file:

```
$ cp app/config.example.php app/config.php
```

Install the <a href="http://getcomposer.org/">Composer</a> dependencies:

```
$ composer install
```

Compile and compress CSS and JS:

```
$ make
```

## License

<a href="http://pierre.mit-license.org/">MIT</a>

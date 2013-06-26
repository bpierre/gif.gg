<?php

define('VERSION', '1');

require_once APP.'/config.php';
require_once APP.'/lib/url-id-manager.php';

use RedBean_Facade as R;
R::setup('mysql:host='.DB_HOST.'; dbname='.DB_NAME, DB_USER, DB_PASS);

$app = new Silex\Application();
$app['debug'] = DEBUG;
$app['version'] = VERSION;

$app->register(new Silex\Provider\TwigServiceProvider(), [
  'twig.path' => APP.'/views',
]);

require_once APP.'/routes.php';

$app->run();


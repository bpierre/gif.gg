<?php

use Symfony\Component\HttpFoundation\Response;
use RedBean_Facade as R;

$id_check = '[\da-zA-Z]+';
$id_manager = new Gifgg\UrlIdManager(GIFS_DIR);

$base_data = [
  'debug' => $app['debug'],
  'version' => $app['version'],
  'ga_id' => defined('GA_ID')? GA_ID : NULL,
  'ga_name' => defined('GA_NAME')? GA_NAME : NULL,
];

$app->get('/', function() use($app, $base_data) {
  return $app['twig']->render('main.html', $base_data);
});

$app->get('/about', function() use($app, $base_data) {
  return $app['twig']->render('about.html', $base_data);
});

$app->post('/', function() use($app, $base_data, $id_manager) {
  if (!isset($_FILES['gif']) ||
      !is_uploaded_file($_FILES['gif']['tmp_name'])) {
    return 0;
  }
  $gif = R::dispense('gif');
  $gif->url_id = $id_manager->get_gif_id();
  $gif->private = TRUE;
  $gif->ip = $_SERVER['REMOTE_ADDR'];
  $gif->created = R::isoDateTime();
  $dest = $id_manager->id_to_path($gif->url_id);
  $moved = move_uploaded_file($_FILES['gif']['tmp_name'], $dest);
  if ($moved) {
    R::store($gif);
    return '/'.$gif->url_id;
  }
  return 0;
});

$app->get('/{url_id}', function($url_id) use($app, $base_data, $id_manager) {
  $url_id = $app->escape($url_id);
  $gif = R::findOne('gif', 'url_id = ?', [$url_id]);
  if ($gif) {
    return $app['twig']->render('single.html', $base_data + [
      'gif_url' => $id_manager->id_to_url($url_id),
      'gif_id' => $url_id,
    ]);
  }
  $app->abort(404, 'Error 404');
})->assert('url_id', $id_check);

$app->get('/twitter-player/{id}', function($id) use($app, $base_data, $id_manager) {
  $id = $app->escape($id);
  if ($id_manager->id_exists($id)) {
    return $app['twig']->render('twitter-player.html', $base_data + [
      'gif_url' => $id_manager->id_to_url($id),
      'gif_id' => $id,
    ]);
  }
  $app->abort(404, 'Error 404');
})->assert('id', $id_check);

$app->error(function(\Exception $e, $code) use($app, $base_data) {
  if ($app['debug'] && $code !== 404) return;
  switch ($code) {
    case 404:
      $message = 'Sorry, the page you are looking for is not available.';
      break;
    default:
      $message = 'Sorry, but something went terribly wrong.';
  }
  return $app['twig']->render('error.html', $base_data + [
    'message' => $message,
  ]);
});


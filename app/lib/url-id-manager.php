<?php

namespace Gifgg;

class UrlIdManager {

  private $gifs_dir = NULL;
  private $id_chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
  private $reserved_ids = ['about'];

  function __construct($gifs_dir) {
    $this->gifs_dir = $gifs_dir;
  }

  function id_to_filename($id) {
    return $id.'.gif';
  }

  function id_to_path($id) {
    return $this->gifs_dir.'/'.$this->id_to_filename($id);
  }

  function id_to_url($id) {
    return '/'.$this->id_to_filename($id);
  }

  function id_exists($id) {
    return file_exists($this->id_to_path($id));
  }

  function get_gif_id($length=7) {
    $id = '';
    for ($i = 0; $i < $length; $i++) {
      $id .= $this->id_chars[mt_rand(0, strlen($this->id_chars))];
    }
    if ($this->id_exists($id) || in_array($id, $this->reserved_ids)) {
      return $this->get_gif_id($length);
    }
    return $id;
  }
}

